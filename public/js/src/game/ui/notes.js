/*
    Users can right-click cards to record information on them
*/

// Imports
const globals = require('./globals');

// Get the contents of the note tooltip
const get = (order, our) => {
    // If we are a player in an ongoing game, return our note
    // (we don't have to check to see if the element exists because
    // all notes are initialized to an empty string)
    if (our || (!globals.replay && !globals.spectating)) {
        return globals.ourNotes[order];
    }

    // Build a string that shows the combined notes from the players & spectators
    let content = '';
    for (const noteObject of globals.allNotes[order]) {
        if (noteObject.note.length > 0) {
            content += `<strong>${noteObject.name}:</strong> ${noteObject.note}<br />`;
        }
    }
    if (content.length !== 0) {
        content = content.substr(0, content.length - 6); // Trim the trailing "<br />"
    }
    return content;
};

// A note has been updated, so:
// 1) update the stored note in memory
// 2) send the new note to the server
// 3) check for new note identities
const set = (order, note) => {
    const oldNote = globals.ourNotes[order];
    globals.ourNotes[order] = note;
    if (globals.spectating) {
        for (const noteObject of globals.allNotes[order]) {
            if (noteObject.name === globals.lobby.username) {
                noteObject.note = note;
            }
        }
    }
    globals.lastNote = note;

    // Send the note to the server
    if (!globals.replay && note !== oldNote) {
        globals.lobby.conn.send('note', {
            order,
            note,
        });
    }

    // Local variables
    let card = globals.deck[order];
    if (!card) {
        card = globals.stackBases[order - globals.deck.length];
    }
    checkSpecialNote(card);
};
exports.set = set;

const checkSpecialNote = (card) => {
    // The note identity features do not apply to spectators and replays
    if (globals.spectating || globals.replay) {
        return;
    }

    // Only examine the text to the right of the rightmost pipe
    // (pipes are a conventional way to append new information to a note
    let note = globals.ourNotes[card.order];
    if (note.includes('|')) {
        const match = note.match(/.*\|(.+)/);
        note = match[1];
    }
    note = note.toLowerCase(); // Make all letters lowercase to simply the matching logic below
    note = note.trim(); // Removing all leading and trailing whitespace

    // Feature 1 - Morph the card if it has an "exact" card note
    morph(card, note);

    // Feature 2 - Give the card a special border if it is chop moved
    card.noteBorder.setVisible(!card.cluedBorder.getVisible() && note.includes('cm'));
};
exports.checkSpecialNote = checkSpecialNote;

// Check to see if we wrote a note that implies that we know the identity of this card
// and morph the card if so
const morph = (card, note) => {
    let noteSuit = null;
    let noteRank = null;
    for (const rank of globals.variant.ranks) {
        if (note === rank.toString()) {
            noteRank = rank;
            break;
        }
        for (const suit of globals.variant.suits) {
            if (
                note === `${suit.abbreviation.toLowerCase()}${rank}` // e.g. "b1" or "B1"
                || note === `${suit.name.toLowerCase()}${rank}` // e.g. "blue1" or "Blue1" or "BLUE1"
                || note === `${suit.name.toLowerCase()} ${rank}` // e.g. "blue 1" or "Blue 1" or "BLUE 1"
                || note === `${rank}${suit.abbreviation.toLowerCase()}` // e.g. "1b" or "1B"
                || note === `${rank}${suit.name.toLowerCase()}` // e.g. "1blue" or "1Blue" or "1BLUE"
                || note === `${rank} ${suit.name.toLowerCase()}` // e.g. "1 blue" or "1 Blue" or "1 BLUE"
            ) {
                noteSuit = suit;
                noteRank = rank;
                break;
            }
        }
        if (noteSuit !== null || noteRank !== null) {
            break;
        }
    }

    // Validate that the note does not contain an impossibility
    if (noteRank !== null && noteSuit === null) {
        // Only the rank was specified
        // (this logic is copied from the "HanabiCard.checkPipPossibilities()" function)
        let rankPossible = false;
        for (const suit of globals.variant.suits) {
            const count = card.possibleCards.get(`${suit.name}${noteRank}`);
            if (count > 0) {
                rankPossible = true;
                break;
            }
        }
        if (!rankPossible) {
            window.alert(`That card cannot possibly be a ${noteSuit.name.toLowerCase()} ${noteRank}.`);
            return;
        }
    }
    if (noteRank !== null && noteSuit !== null) {
        // Both the suit and the rank were specified
        const mapIndex = `${noteSuit.name}${noteRank}`;
        if (card.possibleCards.get(mapIndex) === 0) {
            window.alert(`That card cannot possibly be a ${noteSuit.name.toLowerCase()} ${noteRank}.`);
            return;
        }
    }

    // Set the bare image of the card to match the note
    // (or clear the bare image if the note was deleted/changed)
    card.noteSuit = noteSuit;
    card.noteRank = noteRank;
    card.knownTrash = note === 'kt' || note === 'trash';
    card.needsFix = note === 'fixme';
    card.setBareImage();
    globals.layers.card.batchDraw();
};
exports.morph = morph;

const update = (card) => {
    // Update the tooltip
    const tooltip = $(`#tooltip-${card.tooltipName}`);
    const tooltipInstance = tooltip.tooltipster('instance');
    const note = get(card.order, false);
    tooltipInstance.content(note);
    if (note.length === 0) {
        tooltip.tooltipster('close');
    }

    // Update the card indicator
    const visibleOld = card.noteGiven.getVisible();
    const visibleNew = note.length > 0;
    card.noteGiven.setVisible(visibleNew);
    if (visibleOld !== visibleNew) {
        globals.layers.card.batchDraw();
    }
};
exports.update = update;

// Open the tooltip for this card
const show = (card) => {
    const tooltip = $(`#tooltip-${card.tooltipName}`);
    const tooltipInstance = tooltip.tooltipster('instance');

    // Do nothing if the tooltip is already open
    if (tooltip.tooltipster('status').open) {
        return;
    }

    // We want the tooltip to appear above the card by default
    const pos = card.getAbsolutePosition();
    let posX = pos.x;
    let posY = pos.y - (card.getHeight() * card.parent.scale().y / 2);
    tooltipInstance.option('side', 'top');

    // Flip the tooltip if it is too close to the top of the screen
    if (posY < 200) {
        // 200 is just an arbitrary threshold; 100 is not big enough for the BGA layout
        posY = pos.y + (card.getHeight() * card.parent.scale().y / 2);
        tooltipInstance.option('side', 'bottom');
    }

    // If there is an clue arrow showing, it will overlap with the tooltip arrow,
    // so move it over to the right a little bit
    for (const arrow of globals.elements.arrows) {
        if (arrow.pointingTo === card.order) {
            posX = pos.x + ((card.getWidth() * card.parent.scale().x / 2) / 2.5);
            break;
        }
    }

    // Update the tooltip and open it
    tooltip.css('left', posX);
    tooltip.css('top', posY);
    const note = get(card.order, false);
    tooltipInstance.content(note);
    tooltip.tooltipster('open');
};
exports.show = show;

exports.openEditTooltip = (card) => {
    // Don't edit any notes in replays
    if (globals.replay) {
        return;
    }

    if (globals.editingNote !== null) {
        // Close any existing note tooltips
        const tooltip = $(`#tooltip-card-${globals.editingNote}`);
        tooltip.tooltipster('close');

        // If we are right clicking the card that we were already editing,
        // then just close the existing tooltip and don't do anything else
        if (card.order === globals.editingNote) {
            globals.editingNote = null;
            return;
        }
    }

    show(card);

    globals.editingNote = card.order;
    const note = get(card.order, true);
    const tooltip = $(`#tooltip-${card.tooltipName}`);
    const tooltipInstance = tooltip.tooltipster('instance');
    tooltipInstance.content(`<input id="tooltip-${card.tooltipName}-input" type="text" value="${note}"/>`);

    $(`#tooltip-${card.tooltipName}-input`).on('keydown', (keyEvent) => {
        keyEvent.stopPropagation();
        if (keyEvent.key !== 'Enter' && keyEvent.key !== 'Escape') {
            return;
        }

        globals.editingNote = null;

        let newNote;
        if (keyEvent.key === 'Escape') {
            // Use the existing note, if any
            newNote = get(card.order, true);
        } else if (keyEvent.key === 'Enter') {
            newNote = $(`#tooltip-${card.tooltipName}-input`).val();

            // Strip any HTML elements
            // (to be thorough, the server will also perform this validation)
            newNote = stripHTMLtags(newNote);

            set(card.order, newNote);
        }

        // Check to see if an event happened while we were editing this note
        if (globals.actionOccured) {
            globals.actionOccured = false;
            tooltip.tooltipster('close');
        }

        update(card);
    });

    // Automatically highlight all of the existing text when a note input box is focused
    $(`#tooltip-${card.tooltipName}-input`).focus(function tooltipCardInputFocus() {
        $(this).select();
    });

    // Automatically focus the new text input box
    $(`#tooltip-${card.tooltipName}-input`).focus();
};

// We just got a list of a bunch of notes, so show the note indicator for currently-visible cards
exports.setAllCardIndicators = () => {
    // We iterate through the whole deck instead of using the index of the last drawn card
    // to avoid race conditions where we can get the "noteList"
    // before the "notifyList" is finished processing
    for (const card of globals.deck) {
        setCardIndicator(card.order);
    }
    for (const stackBase of globals.stackBases) {
        setCardIndicator(stackBase.order);
    }
};

const setCardIndicator = (order) => {
    const visible = shouldShowIndicator(order);
    let card = globals.deck[order];
    if (!card) {
        card = globals.stackBases[order - globals.deck.length];
    }
    card.noteGiven.setVisible(visible);

    if (visible && globals.spectating && !globals.replay && !card.noteGiven.rotated) {
        card.noteGiven.rotate(15);
        card.noteGiven.rotated = true;
    }

    globals.layers.card.batchDraw();
};
exports.setCardIndicator = setCardIndicator;

const shouldShowIndicator = (order) => {
    if (globals.replay || globals.spectating) {
        for (const noteObject of globals.allNotes[order]) {
            if (noteObject.note.length > 0) {
                return true;
            }
        }
        return false;
    }

    return globals.ourNotes[order] !== '';
};
exports.shouldShowIndicator = shouldShowIndicator;

/*
    Misc. functions
*/

const stripHTMLtags = (input) => {
    const doc = new DOMParser().parseFromString(input, 'text/html');
    return doc.body.textContent || '';
};
