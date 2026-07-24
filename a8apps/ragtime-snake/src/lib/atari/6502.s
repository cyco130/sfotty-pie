.export ZEROPAGE := $00, size: $100
.export STACK := $0100, size: $100

.export NMIVEC := $FFFA, size: 2
.export RESVEC := $FFFC, size: 2
.export IRQVEC := $FFFE, size: 2
