#!/bin/zsh
cd -- "$(dirname -- "$0")"
if command -v python3 >/dev/null 2>&1; then
  python3 server.py
else
  print "Python 3 is needed. Install it from https://www.python.org/downloads/ and open this file again."
  read -r "reply?Press Return to close."
fi
