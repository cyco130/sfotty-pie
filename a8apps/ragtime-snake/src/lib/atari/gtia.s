.export GTIA_AREA := $D000, size: 256 ; GTIA register area

.export GTIA := $D000, size: $20 ; Canonical GTIA register addresses


.export PAL := $D014

.export TvSystem = {
	MASK: $0E

	PAL: $0
	NTSC: $E
}
