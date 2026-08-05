open_impl = .import "./open.s"
put_impl = .import "./put.s"
get_impl = .import "./get.s"

.import "../fcb.s"
.import "./read-dir.s"

.export open = open_impl::open
.export put  = put_impl::put
.export get  = get_impl::get
