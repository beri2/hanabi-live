package main

import (
	"sync"

	melody "gopkg.in/olahol/melody.v1"
)

var (
	// This is the Melody WebSocket router
	m *melody.Melody

	// We keep track of all WebSocket sessions
	sessions      = make(map[int]*Session)
	sessionsMutex = sync.RWMutex{}

	// We only allow one user to connect or disconnect at the same time
	sessionConnectMutex = sync.Mutex{}

	// We keep track of all ongoing WebSocket messages/commands
	commandWaitGroup sync.WaitGroup
)

func websocketInit() {
	// Fill the command handler map
	// (which is used in the "websocketHandleMessage" function)
	commandInit()

	// Define a new Melody router
	m = melody.New()

	// The default maximum message size is 512 bytes,
	// but this is not long enough to send game objects
	// Thus, we have to manually increase it
	m.Config.MaxMessageSize = 8192

	// Attach some handlers
	m.HandleConnect(websocketConnect)
	m.HandleDisconnect(websocketDisconnect)
	m.HandleMessage(websocketMessage)
	// We could also attach a function to HandleError, but this fires on routine
	// things like disconnects, so it is undesirable
}
