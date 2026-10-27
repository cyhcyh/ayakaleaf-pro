#!/bin/sh
set -eu
exec node /overleaf/deploy/runtime/bootstrap.mjs /sbin/my_init "$@"
