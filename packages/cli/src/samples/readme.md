These samples require the `ca65` assembler from the [`cc65` package](https://github.com/cc65/cc65).

All samples require the [library file](lib/lib.s). For example, to compile the `hello.s` sample, use the following command:

```bash
cl65 -C linker.cfg --target none -o hello.65 lib/lib.s hello.s
```

## TODO

- **`guess` loops forever at stdin EOF.** When input runs out, `STDIN` returns `0`, which `guess` parses as an empty "too low" guess and re-prompts indefinitely. It should check `FSTIN` for EOF (bit 7) before reading and quit gracefully.
- **`echo` and `cat` exit with leftover accumulator values.** Both do `sta EXIT` without first loading an exit code, so `echo` exits with `$0a` (10, the trailing newline) and `cat` with `$80` (128, the EOF status from `FSTIN`). They should `lda #0` (or a meaningful code) before `sta EXIT`.
