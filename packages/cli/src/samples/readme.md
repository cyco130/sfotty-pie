These samples require the `ca65` assembler from the [`cc65` package](https://github.com/cc65/cc65).

All samples require the [library file](lib/lib.s). For example, to compile the `hello.s` sample, use the following command:

```bash
cl65 -C linker.cfg --target none -o hello.65 lib/lib.s hello.s
```
