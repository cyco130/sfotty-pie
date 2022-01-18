.import start

.segment "HEADER"
	; Sfotty binary file header
	.byte "SFOTTY", 0, 0, 0, 0

.segment "VECTORS"
	.addr 0     ; NMI vector not used
	.addr start ; Reset vector is the main entry
	.addr 0     ; IRQ vector not used
