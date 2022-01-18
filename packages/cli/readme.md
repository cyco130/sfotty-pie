# Sfotty Pie CLI

**Sfotty Pie CLI** is an emulator for a virtual 6502-based computer. The current implementation allows you two write CLI programs with access to stdin, stdout, and stderr.

## Executable file format

| Offset | Size     | Description                               |
| ------ | -------- | ----------------------------------------- |
| 0x0000 | 0x06     | Magic number (The word `SFOTTY` in ASCII) |
| 0x0006 | 0x04     | Reserved (must be zero)                   |
| 0x000A | 0x06     | Interrupt vectors                         |
| 0x0010 | variable | Program contents                          |

## System documentation

The interrupt vectors are the NMI, reset, and IRQ vectors, in that order. They are loaded starting from the address `$FFFA`. The NMI and IRQ vectors are currently unused and should be set to 0. The reset vector at `$FFFC` is the main program entry.

The program contents are loaded starting from the address `$0400`.

**Page 2** (addresses from `$0200` to `$02FF`) is reserved for I/O operations. Currently, the following I/O operations are defined:

| Address | Name     | Read / Write | Description                                                   |
| ------- | -------- | ------------ | ------------------------------------------------------------- |
| `$0200` | `EXIT`   | `W`          | Any write here exists the program with the written exit code. |
| `$0201` | `STDIN`  | `R`          | Read a byte from the standard input (blocking).               |
| `$0202` | `STDOUT` | `W`          | Write a byte to the standard output.                          |
| `$0203` | `STDERR` | `W`          | Write a byte to the standard error.                           |
| `$0240` | `RAND`   | `R`          | Read a random byte.                                           |
| `$0241` | `FSTIN`  | `R`          | Status of stdin: EOF if bit 7 set.                            |

On program start, all CPU registers will be in an unknown state. In particular, you should remember to clear the decimal flag. **page 3** (addresses from `$0300` to `$03FF`) will contain the command line arguments as a null-terminated list of null-terminated strings.

Everything other than the I/O area is RAM, including the command line argument area, the program contents, and the interrupt vectors. Free areas will contain all zeroes.

Executing an undocumented opcode ends the program with exit code 2.

## Sample programs

Executables for the sample programs are in the `samples` directory. The sources are available in `src/samples`. You need the `ca65` assembler from the [`cc65` package](https://github.com/cc65/cc65) to build them.

| Name    | Description                       |
| ------- | --------------------------------- |
| `hello` | Prints "Hello, world!" to stdout. |
| `cat`   | Reads stdin and writes to stdout. |
| `echo`  | Prints the arguments to stdout.   |
| `guess` | Guess the number game.            |

## Ideas for future versions

-   Provide a [`lib6502`](http://www.6502.org/users/andre/osa/lib6502.html) implementation (file I/O and more)
-   Provide a `cc65` library implementation
