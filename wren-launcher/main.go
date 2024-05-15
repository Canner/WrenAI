package main

import (
	"flag"

	"github.com/Canner/WrenAI/wren-launcher/commands"
	"github.com/Canner/WrenAI/wren-launcher/config"
)

var disableTelemetry bool

func main() {
	config.InitFlags()
	flag.Parse()

	commands.Launch()
}
