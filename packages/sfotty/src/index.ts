import { VANILLA_OPCODES, Opcode } from "@sfotty-pie/opcodes";

export interface Memory {
	read(address: number, decode?: boolean): number;
	write(address: number, value: number): void;
}

/**
 * Cycle exact MOS Technologies 6502 emulator
 */
export class Sfotty {
	public crashed = false;
	public nmi = 0;

	public PC: number = Math.floor(Math.random() * 65536);
	public A: number = Math.floor(Math.random() * 256);
	public X: number = Math.floor(Math.random() * 256);
	public Y: number = Math.floor(Math.random() * 256);
	public S: number = Math.floor(Math.random() * 256);

	public N: boolean = Math.random() < 0.5;
	public V: boolean = Math.random() < 0.5;
	public D: boolean = Math.random() < 0.5;
	public I: boolean = Math.random() < 0.5;
	public Z: boolean = Math.random() < 0.5;
	public C: boolean = Math.random() < 0.5;

	public trace = false;
	public traceOnce = 0;

	public resetPending = true;
	public tmp = 0;
	public tmp2 = 0;

	public cycleCounter = 0;

	private opcodes: Array<Opcode | undefined>;

	private operations = [() => this.decode()];

	constructor(private readonly memory: Memory) {
		this.opcodes = new Array(256).fill(undefined);
		for (const opcode of VANILLA_OPCODES) {
			this.opcodes[opcode.opcode] = opcode;
		}
	}

	public assertNmi() {
		this.nmi = 3;
	}

	public getP(brk = false) {
		// NV1BDIZC
		return (
			(+this.N << 7) |
			(+this.V << 6) |
			32 |
			(+brk << 4) |
			(+this.D << 3) |
			(+this.I << 2) |
			(+this.Z << 1) |
			+this.C
		);
	}

	public setP(p: number) {
		// NV1BDIZC
		this.N = !!(p & 0x80);
		this.V = !!(p & 0x40);
		// 1
		// B
		this.D = !!(p & 0x08);
		this.I = !!(p & 0x04);
		this.Z = !!(p & 0x02);
		this.C = !!(p & 0x01);
	}

	public run() {
		const next = this.operations[this.cycleCounter++];
		assert(next !== undefined);
		next();
	}

	public print() {
		const opcode = this.memory.read(this.PC);
		const decoded = this.opcodes[opcode];

		let op = 0;
		let ops = "";

		if (!decoded) {
			return (
				`A=${this.A.toString(16).padStart(2, "0")} ` +
				`X=${this.X.toString(16).padStart(2, "0")} ` +
				`Y=${this.Y.toString(16).padStart(2, "0")} ` +
				`S=${this.S.toString(16).padStart(2, "0")} ` +
				(this.N ? "N" : "-") +
				(this.V ? "V" : "-") +
				(this.D ? "D" : "-") +
				(this.I ? "I" : "-") +
				(this.Z ? "Z" : "-") +
				(this.C ? "C" : "-") +
				"\t" +
				this.PC.toString(16).padStart(4, "0") +
				" " +
				"???"
			);
		}

		switch (decoded.mode) {
			case "imp":
			case "acc":
				break;

			case "imm":
			case "zpg":
			case "zpx":
			case "zpy":
			case "inx":
			case "iny":
				op = this.memory.read(this.PC + 1);
				ops = op.toString(16).padStart(2, "0");
				ops = `$${ops}`;
				break;

			case "rel":
				op = this.memory.read(this.PC + 1);
				op = this.PC + (op >= 128 ? op - 256 : op) + 2;
				ops = op.toString(16).padStart(4, "0");
				ops = `$${ops}`;
				break;

			case "abs":
			case "abx":
			case "aby":
			case "ind":
				op =
					this.memory.read(this.PC + 1) +
					this.memory.read(this.PC + 2) * 256;
				ops = op.toString(16).padStart(2, "0");
				ops = `$${ops}`;
				break;

			default:
				assert(false);
		}

		let s = decoded.mnemonic;

		switch (decoded.mode) {
			case "imp":
				break;
			case "acc":
				s += ` A`;
				break;
			case "imm":
				s += ` #${ops}`;
				break;
			case "rel":
			case "zpg":
			case "abs":
				s += ` ${ops}`;
				break;
			case "abx":
			case "zpx":
				s += ` ${ops},X`;
				break;
			case "aby":
			case "zpy":
				s += ` ${ops},Y`;
				break;
			case "ind":
				s += ` (${ops})`;
				break;
			case "inx":
				s += ` (${ops},X)`;
				break;
			case "iny":
				s += ` (${ops}),Y`;
				break;
			default:
				assert(false);
		}

		return (
			`A=${this.A.toString(16).padStart(2, "0")} ` +
			`X=${this.X.toString(16).padStart(2, "0")} ` +
			`Y=${this.Y.toString(16).padStart(2, "0")} ` +
			`S=${this.S.toString(16).padStart(2, "0")} ` +
			(this.N ? "N" : "-") +
			(this.V ? "V" : "-") +
			(this.D ? "D" : "-") +
			(this.I ? "I" : "-") +
			(this.Z ? "Z" : "-") +
			(this.C ? "C" : "-") +
			"\t" +
			this.PC.toString(16).padStart(4, "0") +
			" " +
			s
		);
	}

	private decode() {
		if (this.crashed) {
			return;
		}

		if (this.resetPending) {
			if (this.trace || this.traceOnce) {
				this.traceOnce--;
				// eslint-disable-next-line no-console
				console.log("RESET");
			}

			this.operations = [
				() => this.memory.read(this.PC),

				() => {
					this.memory.read(this.S + 0x0100);
					this.S = (this.S - 1) & 0xff;
				},

				() => {
					this.memory.read(this.S + 0x0100);
					this.S = (this.S - 1) & 0xff;
				},

				() => {
					this.memory.write(this.S + 0x0100, this.getP());
					this.S = (this.S - 1) & 0xff;
				},

				() => (this.tmp = this.memory.read(0xfffc)),

				() => (this.PC = this.memory.read(0xfffd) * 0x100 + this.tmp),

				() => this.decode(),
			];

			this.resetPending = false;
			this.cycleCounter = 0;

			return;
		}

		if (this.nmi) {
			this.nmi--;
		}

		if (this.nmi === 1) {
			this.operations = [
				() => this.memory.read(this.PC),

				() => {
					this.memory.write(this.S + 0x0100, this.PC >> 8);
					this.S = (this.S - 1) & 0xff;
				},

				() => {
					this.memory.write(this.S + 0x0100, this.PC & 255);
					this.S = (this.S - 1) & 0xff;
				},

				() => {
					this.memory.write(this.S + 0x0100, this.getP(false));
					this.S = (this.S - 1) & 0xff;
				},

				() => (this.tmp = this.memory.read(0xfffa)),

				() => (this.PC = this.memory.read(0xfffb) * 0x100 + this.tmp),

				() => this.decode(),
			];

			return;
		}

		if (this.trace || this.traceOnce) {
			this.traceOnce--;
			// eslint-disable-next-line no-console
			console.log(this.print());
		}

		this.cycleCounter = 0;

		const opcode = this.memory.read(this.PC, true);
		this.PC = (this.PC + 1) & 0xffff;
		const decoded = this.opcodes[opcode];
		if (!decoded) {
			this.crashed = true;
			console.error("The 6502 CPU crashed");
			this.PC--;

			return;
		}

		switch (decoded.mnemonic) {
			case "BRK":
				this.operations = [
					() => this.memory.read(this.PC),

					() => {
						this.memory.write(this.S + 0x0100, this.PC >> 8);
						this.S = (this.S - 1) & 0xff;
					},

					() => {
						this.memory.write(this.S + 0x0100, this.PC & 255);
						this.S = (this.S - 1) & 0xff;
					},

					() => {
						this.memory.write(this.S + 0x0100, this.getP(true));
						this.S = (this.S - 1) & 0xff;
					},

					() => (this.tmp = this.memory.read(0xfffe)),

					() =>
						(this.PC = this.memory.read(0xffff) * 0x100 + this.tmp),

					() => this.decode(),
				];
				break;

			case "RTI":
				this.operations = [
					() => this.memory.read(this.PC),
					() => {
						this.memory.read(this.S + 0x0100);
						this.S = (this.S + 1) & 0xff;
					},
					() => {
						this.setP(this.memory.read(this.S + 0x0100));
						this.S = (this.S + 1) & 0xff;
					},
					() => {
						this.PC =
							(this.PC & 0xff00) |
							this.memory.read(this.S + 0x0100);
						this.S = (this.S + 1) & 0xff;
					},
					() =>
						(this.PC =
							(this.PC & 0xff) +
							this.memory.read(this.S + 0x0100) * 0x100),
					() => this.decode(),
				];
				break;

			case "RTS":
				this.operations = [
					() => this.memory.read(this.PC),
					() => {
						this.memory.read(this.S + 0x100);
						this.S = (this.S + 1) & 0xff;
					},
					() => {
						this.PC =
							(this.PC & 0xff00) |
							this.memory.read(this.S + 0x0100);
						this.S = (this.S + 1) & 0xff;
					},
					() =>
						(this.PC =
							(this.PC & 0xff) +
							this.memory.read(this.S + 0x0100) * 0x100),
					() => {
						this.PC = (this.PC + 1) & 0xffff;
						this.memory.read(this.PC);
					},
					() => this.decode(),
				];
				break;

			case "PHP":
			case "PHA":
				this.operations = [
					() => this.memory.read(this.PC),
					() => {
						this.memory.write(
							this.S + 0x0100,
							decoded.mnemonic === "PHA"
								? this.A
								: this.getP(true)
						);
						this.S = (this.S - 1) & 0xff;
					},
					() => this.decode(),
				];
				break;

			case "PLA":
			case "PLP":
				this.operations = [
					() => this.memory.read(this.PC),
					() => {
						this.memory.read(this.S + 0x100);
						this.S = (this.S + 1) & 0xff;
					},
					() => {
						const op = this.memory.read(this.S + 0x0100);
						if (decoded.mnemonic === "PLA") {
							this.A = op;
							this.Z = !op;
							this.N = op >= 0x80;
						} else {
							this.setP(op);
						}
					},
					() => this.decode(),
				];
				break;

			case "JSR":
				this.operations = [
					() => {
						this.tmp = this.memory.read(this.PC);
						this.PC = (this.PC + 1) & 0xffff;
					},
					() => this.memory.read(this.S + 0x100),
					() => {
						this.memory.write(this.S + 0x100, this.PC >> 8);
						this.S = (this.S - 1) & 0xff;
					},
					() => {
						this.memory.write(this.S + 0x100, this.PC & 0xff);
						this.S = (this.S - 1) & 0xff;
					},
					() =>
						(this.PC =
							this.memory.read(this.PC) * 0x100 + this.tmp),
					() => this.decode(),
				];
				break;

			case "JMP":
				if (decoded.mode === "abs") {
					this.operations = [
						() => {
							this.tmp = this.memory.read(this.PC);
							this.PC = (this.PC + 1) & 0xffff;
						},
						() =>
							(this.PC =
								this.memory.read(this.PC) * 0x100 + this.tmp),
						() => this.decode(),
					];
				} else {
					this.operations = [
						() => {
							this.tmp = this.memory.read(this.PC);
							this.PC = (this.PC + 1) & 0xffff;
						},
						() => (this.tmp += this.memory.read(this.PC) * 0x100),
						() => {
							this.tmp2 = this.memory.read(this.tmp);
						},
						() => {
							const lo = (this.tmp + 1) & 0xff;
							const hi = this.tmp & 0xff00;
							this.PC =
								this.memory.read(hi | lo) * 0x100 + this.tmp2;
						},
						() => this.decode(),
					];
				}
				break;

			case "BPL":
			case "BMI":
			case "BVC":
			case "BVS":
			case "BCC":
			case "BCS":
			case "BNE":
			case "BEQ":
				this.operations = [
					// 1
					() => {
						this.tmp = this.memory.read(this.PC);
						this.PC = (this.PC + 1) & 0xffff;
					},

					// 2
					() => {
						let taken: boolean;
						switch (decoded.mnemonic) {
							case "BPL":
								taken = !this.N;
								break;

							case "BMI":
								taken = this.N;
								break;

							case "BVC":
								taken = !this.V;
								break;

							case "BVS":
								taken = this.V;
								break;

							case "BCC":
								taken = !this.C;
								break;

							case "BCS":
								taken = this.C;
								break;

							case "BNE":
								taken = !this.Z;
								break;

							case "BEQ":
								taken = this.Z;
								break;

							default:
								throw new Error(
									"Unknown mnemonic " + decoded.mnemonic
								);
						}

						if (!taken) {
							this.decode();

							return;
						}

						this.memory.read(this.PC);
						this.tmp =
							this.PC +
							(this.tmp >= 128 ? this.tmp - 256 : this.tmp);
						if (this.tmp >> 8 === this.PC >> 8) {
							// No page crossing, skip fixup cycle
							this.PC = this.tmp;
							this.cycleCounter++;
						} else {
							this.PC = (this.PC & 0xff00) | (this.tmp & 0x00ff);
						}
					},

					// 3
					() => (this.PC = this.tmp),

					// 4
					() => this.decode(),
				];
				break;

			case "CLC":
				this.operations = [
					() => {
						this.memory.read(this.PC);
						this.C = false;
					},
					() => this.decode(),
				];
				break;

			case "SEC":
				this.operations = [
					() => {
						this.memory.read(this.PC);
						this.C = true;
					},
					() => this.decode(),
				];
				break;

			case "CLI":
				this.operations = [
					() => {
						this.memory.read(this.PC);
						this.I = false;
					},
					() => this.decode(),
				];
				break;

			case "SEI":
				this.operations = [
					() => {
						this.memory.read(this.PC);
						this.I = true;
					},
					() => this.decode(),
				];
				break;

			case "CLV":
				this.operations = [
					() => {
						this.memory.read(this.PC);
						this.V = false;
					},
					() => this.decode(),
				];
				break;

			case "CLD":
				this.operations = [
					() => {
						this.memory.read(this.PC);
						this.D = false;
					},
					() => this.decode(),
				];
				break;

			case "SED":
				this.operations = [
					() => {
						this.memory.read(this.PC);
						this.D = true;
					},
					() => this.decode(),
				];
				break;

			case "TAY":
				this.operations = [
					() => {
						this.memory.read(this.PC);
						const op = (this.Y = this.A);
						this.Z = !op;
						this.N = op >= 0x80;
					},
					() => this.decode(),
				];
				break;

			case "TYA":
				this.operations = [
					() => {
						this.memory.read(this.PC);
						const op = (this.A = this.Y);
						this.Z = !op;
						this.N = op >= 0x80;
					},
					() => this.decode(),
				];
				break;

			case "TAX":
				this.operations = [
					() => {
						this.memory.read(this.PC);
						const op = (this.X = this.A);
						this.Z = !op;
						this.N = op >= 0x80;
					},
					() => this.decode(),
				];
				break;

			case "TXA":
				this.operations = [
					() => {
						this.memory.read(this.PC);
						const op = (this.A = this.X);
						this.Z = !op;
						this.N = op >= 0x80;
					},
					() => this.decode(),
				];
				break;

			case "TSX":
				this.operations = [
					() => {
						this.memory.read(this.PC);
						this.X = this.S;
					},
					() => this.decode(),
				];
				break;

			case "TXS":
				this.operations = [
					() => {
						this.memory.read(this.PC);
						this.S = this.X;
					},
					() => this.decode(),
				];
				break;

			case "DEX":
				this.operations = [
					() => {
						this.memory.read(this.PC);
						const op = (this.X = (this.X - 1) & 0xff);
						this.Z = !op;
						this.N = op >= 0x80;
					},
					() => this.decode(),
				];
				break;

			case "DEY":
				this.operations = [
					() => {
						this.memory.read(this.PC);
						const op = (this.Y = (this.Y - 1) & 0xff);
						this.Z = !op;
						this.N = op >= 0x80;
					},
					() => this.decode(),
				];
				break;

			case "INX":
				this.operations = [
					() => {
						this.memory.read(this.PC);
						const op = (this.X = (this.X + 1) & 0xff);
						this.Z = !op;
						this.N = op >= 0x80;
					},
					() => this.decode(),
				];
				break;

			case "INY":
				this.operations = [
					() => {
						this.memory.read(this.PC);
						const op = (this.Y = (this.Y + 1) & 0xff);
						this.Z = !op;
						this.N = op >= 0x80;
					},
					() => this.decode(),
				];
				break;

			case "NOP":
				this.operations = [
					() => this.memory.read(this.PC),
					() => this.decode(),
				];
				break;

			case "LDA":
			case "LDX":
			case "LDY":
			case "EOR":
			case "AND":
			case "ORA":
			case "ADC":
			case "SBC":
			case "CMP":
			case "CPX":
			case "CPY":
			case "BIT": // case "LAX": case "NOP":
				{
					const ops: Record<string, () => void> = {
						LDA: () => {
							this.A = this.tmp;
							this.Z = !this.tmp;
							this.N = this.tmp >= 0x80;
						},
						LDX: () => {
							this.X = this.tmp;
							this.Z = !this.tmp;
							this.N = this.tmp >= 0x80;
						},
						LDY: () => {
							this.Z = !this.tmp;
							this.N = this.tmp >= 0x80;
							this.Y = this.tmp;
						},
						EOR: () => {
							this.tmp = this.A ^= this.tmp;
							this.Z = !this.tmp;
							this.N = this.tmp >= 0x80;
						},
						AND: () => {
							this.tmp = this.A &= this.tmp;
							this.Z = !this.tmp;
							this.N = this.tmp >= 0x80;
						},
						ORA: () => {
							this.tmp = this.A |= this.tmp;
							this.Z = !this.tmp;
							this.N = this.tmp >= 0x80;
						},
						ADC: () => {
							if (this.D) {
								// Decimal mode (credit goes to MAME)
								let al =
									(this.A & 0x0f) +
									(this.tmp & 0x0f) +
									+this.C;

								if (al > 9) {
									al += 6;
								}

								let ah =
									(this.A >> 4) +
									(this.tmp >> 4) +
									+(al > 0x0f);

								this.V = !!(
									~(this.A ^ this.tmp) &
									(this.A ^ (ah << 4)) &
									0x80
								);

								if (ah > 9) {
									ah += 6;
								}

								this.C = ah > 15;

								this.tmp = this.A = (ah << 4) | (al & 0x0f);
								this.Z = !this.tmp;
								this.N = this.tmp >= 0x80;
							} else {
								// Binary mode
								const sum = this.A + this.tmp + +this.C;

								this.V = !!(
									~(this.A ^ this.tmp) &
									(this.A ^ sum) &
									0x80
								);
								this.C = sum > 0xff;

								this.tmp = this.A = sum & 0xff;
								this.Z = !this.tmp;
								this.N = this.tmp >= 0x80;
							}
						},
						SBC: () => {
							if (this.D) {
								// Decimal mode (credit goes to MAME)
								const c = +this.C;
								const diff = this.A + (~this.tmp & 0xff) + c;
								let al =
									(this.A & 0x0f) - (this.tmp & 0x0f) - c;
								if ((al & 0xff) > 0x7f) {
									al -= 6;
								}
								let ah =
									(this.A >> 4) -
									(this.tmp >> 4) -
									+((al & 0xff) > 0x7f);

								this.V = !!(
									(this.A ^ this.tmp) &
									(this.A ^ diff) &
									0x80
								);
								this.C = diff > 0xff;
								if (ah & 0x80) {
									ah -= 6;
								}
								this.tmp = this.A = (ah << 4) | (al & 0x0f);
								this.Z = !this.tmp;
								this.N = this.tmp >= 0x80;
							} else {
								// Binary mode
								this.tmp ^= 0xff;
								const carry7 =
									(this.A & 0x7f) +
									(this.tmp & 0x7f) +
									+this.C;
								const result =
									carry7 +
									(this.A & 0x80) +
									(this.tmp & 0x80);

								this.N = !!(result & 0x80);
								this.C = result >= 0x100;
								this.Z = !(result & 0xff);
								this.V = !!(
									((result >> 2) ^ (carry7 >> 1)) &
									64
								);

								this.A = result & 0xff;
							}
						},
						CMP: () => {
							this.tmp ^= 0xff;
							const diff = this.A + this.tmp + 1;
							this.C = diff > 0xff;
							this.tmp = diff & 0xff;
							this.Z = !this.tmp;
							this.N = this.tmp >= 0x80;
						},
						CPX: () => {
							this.tmp ^= 0xff;
							const diff = this.X + this.tmp + 1;
							this.C = diff > 0xff;
							this.tmp = diff & 0xff;
							this.Z = !this.tmp;
							this.N = this.tmp >= 0x80;
						},
						CPY: () => {
							this.tmp ^= 0xff;
							const diff = this.Y + this.tmp + 1;
							this.C = diff > 0xff;
							this.tmp = diff & 0xff;
							this.Z = !this.tmp;
							this.N = this.tmp >= 0x80;
						},
						BIT: () => {
							this.V = !!(this.tmp & 0x40);
							this.N = this.tmp >= 0x80;
							this.tmp = this.A & this.tmp;
							this.Z = !this.tmp;
						},
					};

					switch (decoded.mode) {
						case "imm":
							this.operations = [
								() => {
									this.tmp = this.memory.read(this.PC);
									this.PC = (this.PC + 1) & 0xffff;
								},
								() => {
									ops[decoded.mnemonic]();
									this.decode();
								},
							];
							break;

						case "zpg":
							this.operations = [
								() => {
									this.tmp = this.memory.read(this.PC);
									this.PC = (this.PC + 1) & 0xffff;
								},
								() => (this.tmp = this.memory.read(this.tmp)),
								() => {
									ops[decoded.mnemonic]();
									this.decode();
								},
							];
							break;

						case "abs":
							this.operations = [
								() => {
									this.tmp = this.memory.read(this.PC);
									this.PC = (this.PC + 1) & 0xffff;
								},
								() => {
									this.tmp +=
										this.memory.read(this.PC) * 0x100;
									this.PC = (this.PC + 1) & 0xffff;
								},
								() => (this.tmp = this.memory.read(this.tmp)),
								() => {
									ops[decoded.mnemonic]();
									this.decode();
								},
							];
							break;

						case "zpx":
							this.operations = [
								() => {
									this.tmp = this.memory.read(this.PC);
									this.PC = (this.PC + 1) & 0xffff;
								},
								() => this.memory.read(this.tmp),
								() =>
									(this.tmp = this.memory.read(
										(this.tmp + this.X) & 0xff
									)),
								() => {
									ops[decoded.mnemonic]();
									this.decode();
								},
							];
							break;

						case "zpy":
							this.operations = [
								() => {
									this.tmp = this.memory.read(this.PC);
									this.PC = (this.PC + 1) & 0xffff;
								},
								() => this.memory.read(this.tmp),
								() =>
									(this.tmp = this.memory.read(
										(this.tmp + this.Y) & 0xff
									)),
								() => {
									ops[decoded.mnemonic]();
									this.decode();
								},
							];
							break;

						case "abx":
							this.operations = [
								() => {
									this.tmp = this.memory.read(this.PC);
									this.PC = (this.PC + 1) & 0xffff;
								},
								() => {
									this.tmp +=
										this.memory.read(this.PC) * 0x100;
									this.PC = (this.PC + 1) & 0xffff;
								},
								() => {
									let lo = this.tmp & 0xff;
									const hi = this.tmp & 0xff00;
									lo += this.X;
									if (lo < 0xff) {
										// No page crossing, skip fixup cycle
										this.tmp = this.memory.read(
											this.tmp + this.X
										);
										this.cycleCounter++;
									} else {
										this.memory.read(hi | (lo & 0xff));
									}
								},
								() =>
									(this.tmp = this.memory.read(
										this.tmp + this.X
									)),
								() => {
									ops[decoded.mnemonic]();
									this.decode();
								},
							];
							break;

						case "aby":
							this.operations = [
								() => {
									this.tmp = this.memory.read(this.PC);
									this.PC = (this.PC + 1) & 0xffff;
								},
								() => {
									this.tmp +=
										this.memory.read(this.PC) * 0x100;
									this.PC = (this.PC + 1) & 0xffff;
								},
								() => {
									let lo = this.tmp & 0xff;
									const hi = this.tmp & 0xff00;
									lo += this.Y;
									if (lo < 0xff) {
										// No page crossing, skip fixup cycle
										this.tmp = this.memory.read(
											this.tmp + this.Y
										);
										this.cycleCounter++;
									} else {
										this.memory.read(hi | (lo & 0xff));
									}
								},
								() =>
									(this.tmp = this.memory.read(
										this.tmp + this.Y
									)),
								() => {
									ops[decoded.mnemonic]();
									this.decode();
								},
							];
							break;

						case "inx":
							this.operations = [
								() => {
									this.tmp = this.memory.read(this.PC);
									this.PC = (this.PC + 1) & 0xffff;
								},
								() => {
									this.memory.read(this.tmp);
									this.tmp2 = (this.tmp + this.X) & 0xff;
								},
								() =>
									(this.tmp = this.memory.read(
										this.tmp2++ & 0xff
									)),
								() =>
									(this.tmp +=
										this.memory.read(this.tmp2 & 0xff) *
										0x100),
								() => (this.tmp = this.memory.read(this.tmp)),
								() => {
									ops[decoded.mnemonic]();
									this.decode();
								},
							];
							break;

						case "iny":
							this.operations = [
								() => {
									this.tmp2 = this.memory.read(this.PC);
									this.PC = (this.PC + 1) & 0xffff;
								},
								() => {
									this.tmp = this.memory.read(this.tmp2);
									this.tmp2 = (this.tmp2 + 1) & 0xffff;
								},
								() => {
									this.tmp +=
										this.memory.read(this.tmp2 & 0xff) *
										0x100;
								},
								() => {
									let lo = this.tmp & 0xff;
									const hi = this.tmp & 0xff00;
									lo += this.Y;
									if (lo < 0xff) {
										// No page crossing, skip fixup cycle
										this.tmp = this.memory.read(
											this.tmp + this.Y
										);
										this.cycleCounter++;
									} else {
										this.memory.read(hi | (lo & 0xff));
									}
								},
								() =>
									(this.tmp = this.memory.read(
										this.tmp + this.Y
									)),
								() => {
									ops[decoded.mnemonic]();
									this.decode();
								},
							];
							break;

						default:
							assert(false);
					}
				}
				break;

			case "STA":
			case "STX":
			case "STY": // case "SAX":
				{
					const ops: Record<string, () => void> = {
						STA: () => this.memory.write(this.tmp, this.A),
						STX: () => this.memory.write(this.tmp, this.X),
						STY: () => this.memory.write(this.tmp, this.Y),
					};

					switch (decoded.mode) {
						case "zpg":
							this.operations = [
								() => {
									this.tmp = this.memory.read(this.PC);
									this.PC = (this.PC + 1) & 0xffff;
								},
								() => ops[decoded.mnemonic](),
								() => this.decode(),
							];
							break;

						case "abs":
							this.operations = [
								() => {
									this.tmp = this.memory.read(this.PC);
									this.PC = (this.PC + 1) & 0xffff;
								},
								() => {
									this.tmp +=
										this.memory.read(this.PC) * 0x100;
									this.PC = (this.PC + 1) & 0xffff;
								},
								() => ops[decoded.mnemonic](),
								() => this.decode(),
							];
							break;

						case "zpx":
							this.operations = [
								() => {
									this.tmp =
										(this.memory.read(this.PC) + this.X) &
										0xff;
									this.PC = (this.PC + 1) & 0xffff;
								},
								() => ops[decoded.mnemonic](),
								() => this.decode(),
							];
							break;

						case "zpy":
							this.operations = [
								() => {
									this.tmp =
										(this.memory.read(this.PC) + this.Y) &
										0xff;
									this.PC = (this.PC + 1) & 0xffff;
								},
								() => ops[decoded.mnemonic](),
								() => this.decode(),
							];
							break;

						case "abx":
							this.operations = [
								() => {
									this.tmp = this.memory.read(this.PC);
									this.PC = (this.PC + 1) & 0xffff;
								},
								() => {
									this.tmp +=
										this.memory.read(this.PC) * 0x100;
									this.PC = (this.PC + 1) & 0xffff;
								},
								() => {
									let lo = this.tmp & 0xff;
									const hi = this.tmp & 0xff00;
									lo += this.X;
									// Read from potentially invalid address
									this.memory.read(hi | (lo & 0xff));
									this.tmp += this.X;
								},
								() => ops[decoded.mnemonic](),
								() => this.decode(),
							];
							break;

						case "aby":
							this.operations = [
								() => {
									this.tmp = this.memory.read(this.PC);
									this.PC = (this.PC + 1) & 0xffff;
								},
								() => {
									this.tmp +=
										this.memory.read(this.PC) * 0x100;
									this.PC = (this.PC + 1) & 0xffff;
								},
								() => {
									let lo = this.tmp & 0xff;
									const hi = this.tmp & 0xff00;
									lo += this.Y;
									// Read from potentially invalid address
									this.memory.read(hi | (lo & 0xff));
									this.tmp += this.Y;
								},
								() => ops[decoded.mnemonic](),
								() => this.decode(),
							];
							break;

						case "inx":
							this.operations = [
								() => {
									this.tmp = this.memory.read(this.PC);
									this.PC = (this.PC + 1) & 0xffff;
								},
								() => {
									this.memory.read(this.tmp);
									this.tmp2 = this.tmp + this.X;
								},
								() =>
									(this.tmp = this.memory.read(
										this.tmp2++ & 0xff
									)),
								() =>
									(this.tmp +=
										this.memory.read(this.tmp2 & 0xff) *
										0x100),
								() => ops[decoded.mnemonic](),
								() => this.decode(),
							];
							break;

						case "iny":
							this.operations = [
								() => {
									this.tmp2 = this.memory.read(this.PC);
									this.PC = (this.PC + 1) & 0xffff;
								},
								() =>
									(this.tmp = this.memory.read(this.tmp2++)),
								() => {
									this.tmp +=
										this.memory.read(this.tmp2 & 0xff) *
										0x100;
								},
								() => {
									let lo = this.tmp & 0xff;
									const hi = this.tmp & 0xff00;
									lo += this.Y;
									this.memory.read(hi | (lo & 0xff));
									this.tmp = this.tmp + this.Y;
								},
								() => ops[decoded.mnemonic](),
								() => this.decode(),
							];
							break;

						default:
							assert(false);
					}
				}
				break;

			case "DEC":
			case "INC":
			case "LSR":
			case "ASL":
			case "ROR":
			case "ROL":
				{
					const ops: Record<string, () => number> = {
						DEC: () => (this.tmp2 - 1) & 0xff,
						INC: () => (this.tmp2 + 1) & 0xff,
						LSR: () => {
							this.C = !!(this.tmp2 & 0x01);

							return this.tmp2 >> 1;
						},
						ASL: () => {
							this.C = !!(this.tmp2 & 0x80);

							return (this.tmp2 << 1) & 0xff;
						},
						ROR: () => {
							const r = this.tmp2 | (this.C ? 0x100 : 0);
							this.C = !!(this.tmp2 & 0x01);

							return r >> 1;
						},
						ROL: () => {
							let r = this.tmp2 << 1;
							r |= +this.C;
							this.C = r > 0xff;

							return r & 0xff;
						},
					};

					switch (decoded.mode) {
						case "acc":
							this.operations = [
								() => {
									this.memory.read(this.PC);
									this.tmp2 = this.A;
								},
								() => {
									const r = (this.A =
										ops[decoded.mnemonic]());
									this.Z = !r;
									this.N = r >= 0x80;
									this.decode();
								},
							];
							break;

						case "zpg":
							this.operations = [
								() => {
									this.tmp = this.memory.read(this.PC);
									this.PC = (this.PC + 1) & 0xffff;
								},
								() => (this.tmp2 = this.memory.read(this.tmp)),
								() => {
									this.memory.write(this.tmp, this.tmp2);
									this.tmp2 = ops[decoded.mnemonic]();
									this.Z = !this.tmp2;
									this.N = this.tmp2 >= 0x80;
								},
								() => this.memory.write(this.tmp, this.tmp2),
								() => this.decode(),
							];
							break;

						case "abs":
							this.operations = [
								() => {
									this.tmp = this.memory.read(this.PC);
									this.PC = (this.PC + 1) & 0xffff;
								},
								() => {
									this.tmp +=
										this.memory.read(this.PC) * 0x100;
									this.PC = (this.PC + 1) & 0xffff;
								},
								() => (this.tmp2 = this.memory.read(this.tmp)),
								() => {
									this.memory.write(this.tmp, this.tmp2);
									this.tmp2 = ops[decoded.mnemonic]();
									this.Z = !this.tmp2;
									this.N = this.tmp2 >= 0x80;
								},
								() => this.memory.write(this.tmp, this.tmp2),
								() => this.decode(),
							];
							break;

						case "zpx":
							this.operations = [
								() => {
									this.tmp = this.memory.read(this.PC);
									this.PC = (this.PC + 1) & 0xffff;
								},
								() => this.memory.read(this.tmp),
								() => {
									this.tmp = (this.tmp + this.X) & 0xff;
									this.tmp2 = this.memory.read(this.tmp);
								},
								() => {
									this.memory.write(this.tmp, this.tmp2);
									this.tmp2 = ops[decoded.mnemonic]();
									this.Z = !this.tmp2;
									this.N = this.tmp2 >= 0x80;
								},
								() => this.memory.write(this.tmp, this.tmp2),
								() => this.decode(),
							];
							break;

						case "abx":
							this.operations = [
								() => {
									this.tmp = this.memory.read(this.PC);
									this.PC = (this.PC + 1) & 0xffff;
								},
								() => {
									this.tmp +=
										this.memory.read(this.PC) * 0x100;
									this.PC = (this.PC + 1) & 0xffff;
								},
								() => {
									let lo = this.tmp & 0xff;
									const hi = this.tmp & 0xff00;
									lo += this.X;
									// Read from potentially invalid address
									this.memory.read(hi | (lo & 0xff));
									this.tmp += this.X;
								},
								() => (this.tmp2 = this.memory.read(this.tmp)),
								() => {
									this.memory.write(this.tmp, this.tmp2);
									this.tmp2 = ops[decoded.mnemonic]();
									this.Z = !this.tmp2;
									this.N = this.tmp2 >= 0x80;
								},
								() => this.memory.write(this.tmp, this.tmp2),
								() => this.decode(),
							];
							break;

						default:
							assert(false);
					}
				}
				break;

			default:
				assert(false);
		}
	}
}

function assert(condition: boolean, message?: string): asserts condition {
	if (!condition) {
		throw new Error(message || "Assertion failed");
	}
}
