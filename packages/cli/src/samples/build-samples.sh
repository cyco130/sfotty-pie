set -e

rm -rf ../../samples/
mkdir -p ../../samples/

cl65 -c -C linker.cfg --target none lib/lib.s

for file in *.s; do
  base=`basename $file .s`
  cl65 -C linker.cfg --target none -o ../../samples/$base.65 lib/lib.o $file
done
