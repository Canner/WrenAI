package main

import (
	"flag"

	"github.com/Canner/WrenAI/wren-launcher/commands"
	"github.com/Canner/WrenAI/wren-launcher/config"
	"github.com/pterm/pterm"
)

var disableTelemetry bool

func main() {
	config.InitFlags()

	// help flag
	help := flag.Bool("h", false, "Display help")
	flag.Parse()

	if *help {
		pterm.Info.Println("Usage of Wren launcher:")
		flag.PrintDefaults()
		return
	}

	commands.Launch()
}
