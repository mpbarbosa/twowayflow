import {flow} from "@twowayflow/dsl";
export default flow( "ugly" )
	.node("tabbed",{kind:"source",at:[0,0]})

      .node(   "overIndented"   ,   {
            kind:      "transform",
            at:        [ 240 , 0 ],
      }   )
  .node("trailingCommas", { kind: "sink", at: [480, 0], })
  .edge( "tabbed" , "overIndented" )
	.edge("overIndented","trailingCommas",{label:"rows",})
