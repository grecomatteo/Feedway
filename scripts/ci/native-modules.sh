#!/bin/sh
# Runs inside the runtime base image (see the "Moduli nativi" step of the image job).
# Native modules must come as platform packages with no install scripts: the image installs with --ignore-scripts.
set -eu
mkdir /t && cd /t
npm init -y >/dev/null
npm install --ignore-scripts --no-audit --no-fund @node-rs/argon2@2.2.2 >/dev/null
node --input-type=module -e "
import { hash, verify } from '@node-rs/argon2'
const h = await hash('x')
if (!(await verify(h, 'x'))) process.exit(1)
console.log('argon2 ok on', process.arch)
"
