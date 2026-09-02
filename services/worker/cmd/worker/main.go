package main

import (
	"log"

	"openrum/internal/config"
	"openrum/internal/service"
)

func main() {
	if err := service.Main(config.ServiceWorker); err != nil {
		log.Fatal(err)
	}
}
