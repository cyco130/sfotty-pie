.import "./public.s"
cio = .import "./lib/cio.s"

.export .macro enter_cio
	stx cio::ICSPRZ+1
	tsx
	stx sp_save
.endmacro

.code

.export exit_cio:
	ldx sp_save
	txs
	cpy #0 ; Re-set N flag based on Y
	rts
