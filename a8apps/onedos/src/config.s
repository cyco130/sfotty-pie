.export DRIVE_NO_MAX       = 8 ; Maximum number of drives supported (normally 8 or 15)
.export MAX_BUFFER_SLOTS   = 4 ; Maximum number of buffer slots (each slot is 128 bytes)
.export PARSE_DRIVE_NO     = 0 ; Whether to parse drive numbers or trust CIO (0 = parse, 1 = trust CIO)

; Sanity checks
.if MAX_BUFFER_SLOTS < 1 || MAX_BUFFER_SLOTS > 128
	.error "MAX_BUFFER_SLOTS must be between 1 and 128"
.endif
