.import "./constants.s"
.import "../fcb.s"
cio = .import "../lib/cio.s"

.code

.export read_dir:

	cpx line_buffer_owner
	bne @fill_line_buffer
	ldy fcb + FcbReadDirOffset::LINE_BUFFER_OFFSET,x
	cpy #20
	bne @read_dir_from_line_buffer

	; TODO: Seek to next directory entry

@fill_line_buffer:
	; TODO: Fill the line buffer

@read_dir_from_line_buffer:
	ldy fcb + FcbReadDirOffset::LINE_BUFFER_OFFSET,x
	inc fcb + FcbReadDirOffset::LINE_BUFFER_OFFSET,x
	lda line_buffer,y
	ldy #1
	rts

.bss

line_buffer_owner: .res  1 ; $80 -> free, otherwise IOCB number of owner
line_buffer:       .res 19
