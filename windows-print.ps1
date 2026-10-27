$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
try {
    Add-Type -AssemblyName System.Drawing
    Add-Type -AssemblyName ReachFramework
    Add-Type -AssemblyName System.Printing
    $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
    $server = New-Object System.Printing.LocalPrintServer
    try {
        if ($request.action -eq 'printers') {
            $result = @($server.GetPrintQueues() | ForEach-Object {
                $_.Refresh()
                $fault = ''
                if ($_.IsPaperJammed) { $fault = 'Paper jam. Check the printer.' }
                elseif ($_.IsOutOfPaper) { $fault = 'Paper empty. Load paper.' }
                elseif ($_.IsDoorOpened) { $fault = 'Printer cover is open.' }
                elseif ($_.IsOffline) { $fault = 'Printer is offline.' }
                $blocked = $fault -ne '' -or $_.IsInError -or $_.IsPaused -or $_.NeedUserIntervention
                # File-output queues prompt for a filename and cannot serve unattended guests.
                if ($_.QueuePort.Name -match '^(FILE:|PORTPROMPT:)$' -or $_.Name -match 'Microsoft Print to PDF|XPS Document Writer|OneNote|^Fax$') { return }
                @{ id=$_.Name; name=$_.Name; model=$_.QueueDriver.Name; state=3;
                   message=$_.QueueStatus.ToString(); reasons=@($_.QueueStatus.ToString()); accepting=(-not $blocked);
                   fault=$fault; blocked=$blocked; mediaRemaining=$null; statusSource='Windows print queue - driver-reported' }
            })
        } elseif ($request.action -eq 'media') {
            $settings = New-Object System.Drawing.Printing.PrinterSettings
            $settings.PrinterName = $request.printer
            if (-not $settings.IsValid) { throw 'The selected Windows printer is unavailable.' }
            $result = @($settings.PaperSizes | Where-Object {
                ([Math]::Abs($_.Width-400) -le 8 -and [Math]::Abs($_.Height-600) -le 8) -or
                ([Math]::Abs($_.Width-600) -le 8 -and [Math]::Abs($_.Height-400) -le 8)
            } | ForEach-Object { @{id=[string]$_.RawKind; name=('4 x 6 inch - ' + $_.PaperName)} })
        } elseif ($request.action -eq 'job') {
            $queue = $server.GetPrintQueue($request.printer)
            try {
                # A job disappearing is not evidence of successful physical output.
                $job = @($queue.GetPrintJobInfoCollection() | Where-Object JobIdentifier -eq $request.jobId) | Select-Object -First 1
                $result = 'unknown'
                if ($null -ne $job) {
                    if ($job.IsDeleted -or $job.IsDeleting) { $result='cancelled' }
                    elseif ($job.IsCompleted -or $job.IsPrinted) { $result='completed' }
                    elseif ($job.IsInError) { $result='stopped' }
                    elseif ($job.IsPaused) { $result='held' }
                    elseif ($job.IsPrinting) { $result='processing' }
                    else { $result='queued' }
                }
            } finally { $queue.Dispose() }
        } elseif ($request.action -in @('submit', 'check')) {
            Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Printing;
using System.IO;
using System.Runtime.InteropServices;
public static class MisrahPrint {
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
    struct DocInfo { public int size; public string name; public string output; public string type; public int flags; }
    [DllImport("gdi32.dll", CharSet=CharSet.Unicode)] static extern IntPtr CreateDC(string driver, string device, string output, IntPtr mode);
    [DllImport("gdi32.dll", CharSet=CharSet.Unicode)] static extern int StartDoc(IntPtr dc, ref DocInfo info);
    [DllImport("gdi32.dll")] static extern int StartPage(IntPtr dc);
    [DllImport("gdi32.dll")] static extern int EndPage(IntPtr dc);
    [DllImport("gdi32.dll")] static extern int EndDoc(IntPtr dc);
    [DllImport("gdi32.dll")] static extern int AbortDoc(IntPtr dc);
    [DllImport("gdi32.dll")] static extern bool DeleteDC(IntPtr dc);
    [DllImport("gdi32.dll")] static extern int GetDeviceCaps(IntPtr dc, int index);
    [DllImport("kernel32.dll")] static extern IntPtr GlobalLock(IntPtr handle);
    [DllImport("kernel32.dll")] static extern bool GlobalUnlock(IntPtr handle);
    [DllImport("kernel32.dll")] static extern IntPtr GlobalFree(IntPtr handle);
    public static int Submit(string printer, int paperId, byte[] jpeg) {
        var settings = new PrinterSettings { PrinterName=printer, Copies=1, PrintToFile=false };
        if (!settings.IsValid) throw new Exception("Selected Windows printer is unavailable.");
        PaperSize paper=null;
        foreach (PaperSize item in settings.PaperSizes) {
            if (item.RawKind==paperId && ((Math.Abs(item.Width-400)<=8 && Math.Abs(item.Height-600)<=8) ||
                (Math.Abs(item.Width-600)<=8 && Math.Abs(item.Height-400)<=8))) { paper=item; break; }
        }
        if (paper==null) throw new Exception("Selected 4 x 6 paper is unavailable.");
        var page = new PageSettings(settings) { PaperSize=paper, Landscape=false };
        if (settings.CanDuplex) settings.Duplex=Duplex.Simplex;
        IntPtr mode=IntPtr.Zero, dc=IntPtr.Zero;
        bool started=false;
        try {
            mode=settings.GetHdevmode(page);
            var pointer=GlobalLock(mode);
            if (pointer==IntPtr.Zero) throw new Exception("Cannot read Windows printer settings.");
            try { dc=CreateDC("WINSPOOL", printer, null, pointer); } finally { GlobalUnlock(mode); }
            if (dc==IntPtr.Zero) throw new Exception("Cannot open Windows printer.");
            using (var stream=new MemoryStream(jpeg)) using (var image=Image.FromStream(stream)) {
                var info=new DocInfo { size=Marshal.SizeOf(typeof(DocInfo)), name="Misrah portrait" };
                int jobId=StartDoc(dc, ref info);
                if (jobId<=0) throw new Exception("Windows print service did not confirm the job.");
                started=true;
                if (StartPage(dc)<=0) throw new Exception("Windows print service did not confirm the page.");
                using (var graphics=Graphics.FromHdc(dc)) {
                    graphics.PageUnit=GraphicsUnit.Pixel;
                    graphics.Clear(Color.White);
                    float width=GetDeviceCaps(dc,8), height=GetDeviceCaps(dc,10);
                    // Rotate the portrait when the driver exposes a native 6 x 4 page.
                    if (width>height) image.RotateFlip(RotateFlipType.Rotate90FlipNone);
                    float scale=Math.Min(width/image.Width,height/image.Height);
                    graphics.InterpolationMode=System.Drawing.Drawing2D.InterpolationMode.HighQualityBicubic;
                    graphics.DrawImage(image,(width-image.Width*scale)/2,(height-image.Height*scale)/2,image.Width*scale,image.Height*scale);
                }
                if (EndPage(dc)<=0 || EndDoc(dc)<=0) throw new Exception("Windows print service did not confirm completion of submission. Check the queue.");
                started=false;
                return jobId;
            }
        } catch (Exception error) {
            if (started) throw new Exception("Windows print service did not confirm submission. Check the queue before printing again. " + error.Message);
            throw;
        } finally {
            if (started && dc!=IntPtr.Zero) AbortDoc(dc);
            if (dc!=IntPtr.Zero) DeleteDC(dc);
            if (mode!=IntPtr.Zero) GlobalFree(mode);
        }
    }
}
'@
            if ($request.action -eq 'check') { $result = $true }
            else { $result = [MisrahPrint]::Submit([string]$request.printer, [int]$request.media, [Convert]::FromBase64String($request.image)) }
        } else { throw 'Unknown Windows print operation.' }
        @{ result=$result } | ConvertTo-Json -Depth 8 -Compress
    } finally { $server.Dispose() }
} catch {
    @{ error=$_.Exception.Message } | ConvertTo-Json -Compress
    exit 1
}
