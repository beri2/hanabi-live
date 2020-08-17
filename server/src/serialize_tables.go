package main

import (
	"encoding/json"
	"io/ioutil"
	"log"
	"os"
	"path"
	"strconv"
	"time"

	"github.com/mitchellh/mapstructure"
)

// serializeTables saves any ongoing tables to disk as JSON files so that they can be restored later
func serializeTables() bool {
	tablesMutex.RLock()
	defer tablesMutex.RUnlock()

	for _, t := range tables {
		// Only serialize ongoing games
		if !t.Running || t.Replay {
			logger.Info("Skipping due to it being unstarted or a replay.")
			continue
		}

		logger.Info("Serializing table:", t.ID)

		// Several fields on the Table object and the Game object are set with `json:"-"` to prevent
		// the JSON encoder from serializing them
		// Otherwise, we would have to explicitly unset some fields here to avoid circular
		// references, session data, and so forth
		t.Mutex.Lock()
		var tableJSON []byte
		if v, err := json.Marshal(t); err != nil {
			logger.Error("Failed to marshal table "+strconv.FormatUint(t.ID, 10)+":", err)
			return false
		} else {
			tableJSON = v
		}
		t.Mutex.Unlock()

		tableFilename := strconv.FormatUint(t.ID, 10) + ".json"
		tablePath := path.Join(tablesPath, tableFilename)
		if err := ioutil.WriteFile(tablePath, tableJSON, 0600); err != nil {
			logger.Error("Failed to write \""+tablePath+"\":", err)
			return false
		}
	}

	return true
}

// restoreTables recreates tables that were ongoing at the time of the last server restart
// Tables were serialized to flat files in the "tablesPath" directory
func restoreTables() {
	var files []os.FileInfo
	if v, err := ioutil.ReadDir(tablesPath); err != nil {
		log.Fatal("Failed to get the files in the \""+tablesPath+"\" directory: ", err)
		return
	} else {
		files = v
	}

	for _, f := range files {
		if f.Name() == ".gitignore" {
			continue
		}

		tablePath := path.Join(tablesPath, f.Name())
		var tableJSON []byte
		if v, err := ioutil.ReadFile(tablePath); err != nil {
			log.Fatal("Failed to read \""+tablePath+"\":", err)
			return
		} else {
			tableJSON = v
		}

		t := &Table{} // We must initialize the table for "Unmarshal()" to work
		if err := json.Unmarshal(tableJSON, t); err != nil {
			logger.Fatal("Failed to unmarshal \""+tablePath+"\":", err)
			return
		}

		// Restore the circular references that could not be represented in JSON
		g := t.Game
		g.Table = t
		g.Options = t.Options
		g.ExtraOptions = t.ExtraOptions
		for _, gp := range g.Players {
			gp.Game = g
		}

		// Restore the types of the actions
		for i, a := range g.Actions {
			if action, ok := a.(map[string]interface{}); !ok {
				logger.Fatal("Failed to convert the action " + strconv.Itoa(i) + " of table " +
					strconv.FormatUint(t.ID, 10) + " to a map.")
			} else if action["type"] == "draw" {
				actionDraw := ActionDraw{}
				if err := mapstructure.Decode(a, &actionDraw); err != nil {
					logger.Fatal("Failed to convert the action " + strconv.Itoa(i) + " of table " +
						strconv.FormatUint(t.ID, 10) + " to a draw action.")
				}
				g.Actions[i] = actionDraw
			}
			// (we don't have to bother converting any other actions)
		}

		// Ensure that all of the players are not present
		// (they were presumably present and connected when the table serialization happened)
		for _, p := range t.Players {
			p.Present = false
		}

		if g.Options.Timed {
			// Give the current player some additional seconds to make up for the fact that they are
			// forced to refresh
			g.Players[g.ActivePlayerIndex].Time += 20 * time.Second

			// Players will never run out of time on restored tables because the "CheckTimer()"
			// function was never initiated; manually do this
			go g.CheckTimer(g.Turn, g.PauseCount, g.Players[g.ActivePlayerIndex])
		}

		tables[t.ID] = t
		// (we don't need to lock "tablesMutex" because we are still in the synchronous phase of
		// startup)
		logger.Info(t.GetName() + "Restored table.")

		if err := os.Remove(tablePath); err != nil {
			logger.Fatal("Failed to delete \""+tablePath+"\":", err)
		}

		// Restored tables will never be automatically terminated due to idleness because the
		// "CheckIdle()" function was never initiated; manually do this
		go t.CheckIdle()
	}

	// (we do not need to adjust the "tableIDCounter" variable because
	// we have logic to not allow duplicate game IDs)

	msg := "Restored " + strconv.Itoa(len(tables)) + " table"
	if len(tables) >= 2 {
		msg += "s"
	}
	msg += "."
	logger.Info(msg)
}
