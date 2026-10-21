// Mijn schaakvariant - prototype 1


const aiMovesThisGame = [];


function getAIStateKey() {
  const boardKey = board.map(row =>
    row.map(piece => piece || "--").join(",")
  ).join("/");

  const minesKey = [...mines].sort().join(";");

  const bishopsKey = [...bishopsMustMove]
    .sort()
    .join(";");

  const queenKey =
    `w:${queenBreakthroughReady.w},` +
    `b:${queenBreakthroughReady.b}`;

  const enPassantKey = enPassantTarget
    ? `${enPassantTarget.row},${enPassantTarget.col}`
    : "none";

  const castlingKey = JSON.stringify(hasMoved);

  return [
    boardKey,
    `mines:${minesKey}`,
    `bishops:${bishopsKey}`,
    `queen:${queenKey}`,
    `enPassant:${enPassantKey}`,
    `castling:${castlingKey}`
  ].join("|");
}

function getAIMoveKey(move) {
  return (
    move.stateKey +
    "|" +
    move.fromRow + "," + move.fromCol +
    ">" +
    move.toRow + "," + move.toCol +
    "|" +
    (move.action || "")
  );
}

function getAIMoveValue(move) {
  return aiMemory[getAIMoveKey(move)] || 0;
}

async function teachAI(move, reward) {
  const key = getAIMoveKey(move);

  // Update de score lokaal in het geheugen
  aiMemory[key] = (aiMemory[key] || 0) + reward;

  // Sla het direct op in Firebase onder 'ai/memory'
  if (firebaseUser) {
    try {
      await update(ref(database, "ai/memory"), {
        [key]: aiMemory[key]
      });
      console.log("AI geleerd en opgeslagen in Firebase! Totaal geheugen items:", Object.keys(aiMemory).length);
    } catch (error) {
      console.error("Fout bij opslaan AI geheugen in Firebase:", error);
    }
  }
}


function getFutureThreatPenalty(move) {
  const piece = board[move.fromRow][move.fromCol];

  if (!piece) return 0;

  // Voorlopig nog geen speciale zetten simuleren.
  if (
    move.action ||
    board[move.toRow][move.toCol] ||
    piece[1] === "r" ||
    piece[1] === "p"
  ) {
    return 0;
  }

  const originalBoard = board;

  try {
    // Maak een tijdelijke kopie van het bord.
    board = copyBoard(originalBoard);

    // Voer de AI-zet tijdelijk uit.
    board[move.toRow][move.toCol] = piece;
    board[move.fromRow][move.fromCol] = null;

    // Kijk welke zetten wit daarna heeft.
    const whiteMoves = getAllLegalMoves("w");

    // Kan wit precies het stuk slaan dat de AI net verplaatst heeft?
    const canCaptureMovedPiece = whiteMoves.some(reply => {

      // Gewone vangst op de nieuwe positie.
      if (
        reply.toRow === move.toRow &&
        reply.toCol === move.toCol
      ) {
        return true;
      }

      // Queen breakthrough:
      // controleer of het verplaatste stuk ergens
      // op het pad van de witte dame ligt.
      if (reply.action === "queenBreakthrough") {
        const path = getPathSquares(
          reply.fromRow,
          reply.fromCol,
          reply.toRow,
          reply.toCol
        );

        return path.some(square =>
          square.row === move.toRow &&
          square.col === move.toCol
        );
      }

      return false;
    });

    if (canCaptureMovedPiece) {
      // Hoe waardevoller het stuk dat de AI verplaatst,
      // hoe groter de straf.
      return getPieceValue(piece) * 3;
    }

    return 0;

  } finally {
    // Herstel altijd het echte bord.
    board = originalBoard;
  }
}


function getTwoPlyPenalty(move) {
  const piece = board[move.fromRow][move.fromCol];

  if (!piece) return 0;

  // Bewaar het echte bord.
  const originalBoard = board;

  try {
    // Maak een tijdelijke bordkopie.
    board = copyBoard(originalBoard);

    // Voer de zet van de AI voorlopig uit.
    board[move.toRow][move.toCol] = piece;
    board[move.fromRow][move.fromCol] = null;

    // Verzamel de mogelijke reacties van wit.
    const whiteMoves = getAllLegalMoves("w");

    let worstPenalty = 0;

    for (const reply of whiteMoves) {
      const whitePiece =
        board[reply.fromRow][reply.fromCol];

      const blackTarget =
        board[reply.toRow][reply.toCol];

      // Kijk of wit een zwart stuk kan slaan.
      if (blackTarget && blackTarget[0] === "b") {
        const penalty = getPieceValue(blackTarget);

        worstPenalty = Math.max(
          worstPenalty,
          penalty
        );
      }
    }

    return worstPenalty * 2;

  } finally {
    // Zet het echte bord altijd terug.
    board = originalBoard;
  }
}


function getBestAIMove(moves) {
  if (moves.length === 0) return null;

  let bestValue = -Infinity;
  let bestMoves = [];

  for (const move of moves) {
    // 1. Bewaar het bord en de mijnen tijdelijk om te kunnen simuleren
    const originalBoard = copyBoard(board);
    const originalMines = new Set(mines);
    
    let moveScore = getBotMoveScore(move) + (getAIMoveValue(move) * 0.25);

    try {
      // Voer de zet tijdelijk uit op een kopie van het bord
      simulateMoveForAI(move);

      // 2. Kijk wat de beste reactie van Wit (de speler) hierop zou kunnen zijn
      const whiteLegalMoves = getAllLegalMoves("w");
      let worstWhiteResponse = 0;

      for (const whiteMove of whiteLegalMoves) {
        let threatScore = 0;
        const targetPiece = board[whiteMove.toRow][whiteMove.toCol];
        
        if (targetPiece) {
          threatScore = getPieceValue(targetPiece) * 10;
        }

        // Als wit een sterke tegenzet heeft, straffen we deze AI-zet af
        if (threatScore > worstWhiteResponse) {
          worstWhiteResponse = threatScore;
        }
      }

      // Trek de dreiging van wit af van de score van de AI-zet
      moveScore -= worstWhiteResponse * 1.5;

    } finally {
      // Herstel het echte bord en de mijnen altijd
      board = originalBoard;
      mines = originalMines;
    }

    // Voeg een kleine willekeurige factor toe zodat de AI gevarieerd blijft spelen
    const finalValue = moveScore + (Math.random() * 0.5);

    if (finalValue > bestValue) {
      bestValue = finalValue;
      bestMoves = [move];
    } else if (finalValue === bestValue) {
      bestMoves.push(move);
    }
  }

  return bestMoves[Math.floor(Math.random() * bestMoves.length)];
}

// Hulpfunctie om een zet tijdelijk te simuleren voor de AI
function simulateMoveForAI(move) {
  const piece = board[move.fromRow][move.fromCol];
  if (!piece) return;

  if (move.action === "shoot") {
    board[move.toRow][move.toCol] = null; // Doelstuk wegschieten
    return;
  }

  board[move.toRow][move.toCol] = piece;
  board[move.fromRow][move.fromCol] = null;
}

function makeLearningAIMove() {
  const moves = getAllLegalMoves("b");

  console.log("Zetten van de bot:", moves);

  if (!Array.isArray(moves)) {
    console.error(
      "Fout: getAllLegalMoves('b') heeft geen lijst teruggegeven."
    );
    return;
  }

  if (moves.length === 0) {
    console.log("De bot heeft geen legale zetten.");
    return;
  }

  // Laat de rest van je bestaande code hier staan.
  const stateKey = getAIStateKey();

  const move = getBestAIMove(
    moves.map(candidate => ({
      ...candidate,
      stateKey
    }))
  );

  if (!move) {
    return;
  }

  // Bewaar de volledige zet inclusief de bordpositie.
  aiMovesThisGame.push({ ...move });

  if (move.action === "shoot") {
    shootPiece(
      move.fromRow,
      move.fromCol,
      move.toRow,
      move.toCol
    );
    return;
  }

  movePiece(
    move.fromRow,
    move.fromCol,
    move.toRow,
    move.toCol,
    {
      row: move.toRow,
      col: move.toCol,
      action: move.action,
      rookFromCol: move.rookFromCol,
      rookToCol: move.rookToCol
    }
  );
}


import { initializeApp } from
  "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";

import {
  getAuth,
  signInAnonymously
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";

import {
  getDatabase,
  ref,
  get,
  set,
  update,
  onValue,
  runTransaction
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-database.js";

// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyCPbzG2HY8aEdW1cYaR0qEV7wJ564bJjsA",
  authDomain: "war-chess-66067.firebaseapp.com",
  databaseURL: "https://war-chess-66067-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "war-chess-66067",
  storageBucket: "war-chess-66067.firebasestorage.app",
  messagingSenderId: "916120123180",
  appId: "1:916120123180:web:c73276e77f93a2b3555e89",
  measurementId: "G-N03J3BXY3C"
};

const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const database = getDatabase(firebaseApp);
console.log("Firebase Database verbonden:", database);
let aiMemory = {};

// Haal het geheugen op uit Firebase nu 'database' klaar is voor gebruik:
get(ref(database, "ai/memory")).then(snapshot => {
  if (snapshot.exists()) {
    aiMemory = snapshot.val();
    console.log("AI geheugen succesvol geladen uit Firebase! Aantal opgeslagen zetten:", Object.keys(aiMemory).length);
  } else {
    console.log("Nog geen AI geheugen gevonden in Firebase, we beginnen vers.");
  }
}).catch(error => {
  console.error("Kon AI geheugen niet laden:", error);
});



let firebaseUser = null;
let applyingRemoteState = false;
let roomListener = null;

const multiplayerStatus =
  document.querySelector("#multiplayer-status");

signInAnonymously(auth)
  .then(({ user }) => {
    firebaseUser = user;
    multiplayerStatus.textContent =
      "Connected to Firebase. Create or join a room.";
  })
  .catch(error => {
    console.error("Firebase-aanmelding mislukt:", error);
    multiplayerStatus.textContent =
      "Firebase kon niet verbinden. Controleer je configuratie en beveiligingsregels.";
  });
const playerNameInput = document.querySelector("#player-name");
const createRoomButton = document.querySelector("#create-room");
const joinRoomButton = document.querySelector("#join-room");
const roomCodeInput = document.querySelector("#room-code");
const playerColorElement = document.querySelector("#player-color");
const whitePlayerElement = document.querySelector("#white-player");
const blackPlayerElement = document.querySelector("#black-player");

let currentRoomCode = null;
let myColor = null;
function updatePlayerColor() {
  if (myColor === "w") {
    playerColorElement.textContent = "Jij speelt als Wit";
  } else if (myColor === "b") {
    playerColorElement.textContent = "Jij speelt als Zwart";
  } else {
    playerColorElement.textContent = "";
  }
}


createRoomButton.addEventListener("click", async () => {
  if (!firebaseUser) {
    multiplayerStatus.textContent = "Not connected to Firebase.";
    return;
  }

  const code = Math.random().toString(36).substring(2, 8).toUpperCase();

  await set(ref(database, `rooms/${code}`), {
    players: {
      white: firebaseUser.uid,
      black: null
    },
    names: {
      white: playerNameInput.value.trim() || "Speler 1"
    },
    createdAt: Date.now()
  });
currentRoomCode = code;
myColor = "w";
updatePlayerColor();

await publishGameState();
listenToRoom();

  multiplayerStatus.textContent =
    `Kamer aangemaakt! Code: ${code}`;
});

joinRoomButton.addEventListener("click", async () => {
  const code = roomCodeInput.value.trim().toUpperCase();

  if (!code) {
    multiplayerStatus.textContent = "Type roomcode.";
    return;
  }

  if (!firebaseUser) {
    multiplayerStatus.textContent = "Not connected to Firebase yet.";
    return;
  }

  const roomRef = ref(database, `rooms/${code}`);
  const snapshot = await get(roomRef);

  if (!snapshot.exists()) {
    multiplayerStatus.textContent = "Deze kamer bestaat niet.";
    return;
  }

  const room = snapshot.val();

  if (room.players.black && room.players.black !== firebaseUser.uid) {
    multiplayerStatus.textContent = "Deze kamer zit al vol.";
    return;
  }

  await update(roomRef, {
    "players/black": firebaseUser.uid,
    "names/black": playerNameInput.value.trim() || "Speler 2"
  });

  currentRoomCode = code;
  myColor = "b";
  updatePlayerColor();
  listenToRoom();


  multiplayerStatus.textContent =
    `You are connected to room ${code}.`;
});



const pieceImages = {
  wp: "Images/White-Pawn.png",
  bp: "Images/Black-Pawn.png",
  wb: "Images/White-Bishop.png",
  bb: "Images/Black-Bishop.png",
  wr: "Images/White-Rook.png",
  br: "Images/Black-Rook.png",
  wn: "Images/White-Knight.png",
  bn: "Images/Black-Knight.png",
  wq: "Images/White-Queen.png",
  bq: "Images/Black-Queen.png",
  wk: "Images/White-King.png",
  bk: "Images/Black-King.png"
};

const startingBoard = [
  ["br", "bn", "bb", "bq", "bk", "bb", "bn", "br"],
  ["bp", "bp", "bp", "bp", "bp", "bp", "bp", "bp"],
  [null, null, null, null, null, null, null, null],
  [null, null, null, null, null, null, null, null],
  [null, null, null, null, null, null, null, null],
  [null, null, null, null, null, null, null, null],
  ["wp", "wp", "wp", "wp", "wp", "wp", "wp", "wp"],
  ["wr", "wn", "wb", "wq", "wk", "wb", "wn", "wr"]
];

const boardElement = document.querySelector("#board");
const turnElement = document.querySelector("#turn");
const messageElement = document.querySelector("#message");
const resetButton = document.querySelector("#reset");
const capturedBlackElement = document.querySelector("#captured-black");
const capturedWhiteElement = document.querySelector("#captured-white");
const moveHistoryElement = document.querySelector("#move-history");
const moveCountElement = document.querySelector("#move-count");
const capturedPieces = { w: [], b: [] };
let moveHistory = [];
function getGameState() {

  return {
    board: board.map(row => row.map(piece => piece || "")),
    currentPlayer,
    hasMoved,
    gameOver,
    mines: [...mines],
    bishopsMustMove: [...bishopsMustMove],
    queenBreakthroughReady,
    enPassantTarget,
    capturedPieces,
    moveHistory,
    gameOverReason,
gameOverWinner,
  };
}

async function publishGameState() {
  if (!firebaseUser || !currentRoomCode) return;

  await update(ref(database, `rooms/${currentRoomCode}`), {
    state: getGameState()
  });
}
function listenToRoom() {
  if (!currentRoomCode) return;

  onValue(ref(database, `rooms/${currentRoomCode}`), snapshot => {
    const room = snapshot.val();
const state = room?.state;

if (!state) return;
whitePlayerElement.textContent =
  `Wit: ${room.names?.white || "Wachten..."}`;

blackPlayerElement.textContent =
  `Zwart: ${room.names?.black || "Wachten..."}`;



  
    console.log("Ontvangen game-state:", state);

    if (
  !Array.isArray(state.board) ||
  state.board.length !== 8 ||
  state.board.some(row => !Array.isArray(row) || row.length !== 8)
) {
  console.error("Ongeldige board ontvangen:", state.board);
  return;
}

board = state.board.map(row =>
  row.map(piece => piece || null)
);


    currentPlayer = state.currentPlayer;
    gameOver = state.gameOver;
    hasMoved = state.hasMoved || {
  wKing: false,
  bKing: false,
  wRookLeft: false,
  wRookRight: false,
  bRookLeft: false,
  bRookRight: false
};


    mines = new Set(state.mines || []);
    bishopsMustMove = new Set(state.bishopsMustMove || []);
    queenBreakthroughReady = state.queenBreakthroughReady || {
      w: false,
      b: false
    };
    enPassantTarget = state.enPassantTarget || null;

    capturedPieces.w = state.capturedPieces?.w || [];
    capturedPieces.b = state.capturedPieces?.b || [];
    moveHistory = state.moveHistory || [];

   // Voorkom dat ontvangen gegevens opnieuw naar Firebase worden gestuurd.
applyingRemoteState = true;

try {
  // Neem de gegevens over het einde van het spel over.
  gameOverReason = state.gameOverReason || "";
  gameOverWinner = state.gameOverWinner || null;

  renderBoard();
} finally {
  applyingRemoteState = false;
}

// Toon de eindmelding ook bij de andere speler.
if (gameOver && !gameOverPopup) {
  const winnerName = gameOverWinner === "w" ? "Wit" : "Zwart";

  showGameOverPopup(
    `${winnerName} wint!`,
    gameOverReason || "Het spel is afgelopen."
  );
}


// Neem ook de gegevens over het einde van het spel over.
gameOverReason = state.gameOverReason || "";
gameOverWinner = state.gameOverWinner || null;

// Toon de eindmelding ook bij de andere speler.
if (gameOver && gameOverReason && !gameOverPopup) {
  const winnerName = gameOverWinner === "w" ? "Wit" : "Zwart";
  showGameOverPopup(`${winnerName} wint!`, gameOverReason);
}

    

  });
}


let lastRenderedCounts = null;
let lastBoardSignature = null;
const pieceNames = { p: "Pion", n: "Paard", b: "Loper", r: "Toren", q: "Dame", k: "Koning" };

function boardCounts(source = board) {
  const counts = {};
  for (const row of source) {
    for (const piece of row) {
      if (piece) counts[piece] = (counts[piece] || 0) + 1;
    }
  }
  return counts;
}

function boardSignature(source = board) {
  return source.map(row => row.map(piece => piece || "--").join(",")).join("|");
}

function updateCapturedPieces() {
  const counts = boardCounts();

  if (lastRenderedCounts) {
    for (const color of ["w", "b"]) {
      for (const type of ["p", "n", "b", "r", "q", "k"]) {
        const key = color + type;
        const lost = (lastRenderedCounts[key] || 0) - (counts[key] || 0);

        for (let i = 0; i < lost; i++) {
          capturedPieces[color].push(key);
        }
      }
    }
  }

  lastRenderedCounts = counts;
  renderCapturedSide("w", capturedWhiteElement);
  renderCapturedSide("b", capturedBlackElement);
}

function renderCapturedSide(color, element) {
  element.innerHTML = "";

  if (!capturedPieces[color].length) {
    const empty = document.createElement("span");
    empty.className = "empty-captured";
    empty.textContent = "No losses...yet.";
    element.appendChild(empty);
    return;
  }

  for (const piece of capturedPieces[color]) {
    const img = document.createElement("img");
    img.className = "captured-piece";
    img.src = pieceImages[piece];
    img.alt = pieceNames[piece[1]];
    img.title = pieceNames[piece[1]];
    element.appendChild(img);
  }
}


function addMoveHistory(text, player = (currentPlayer === "w" ? "Wit" : "Zwart")) {
  if (!text) return;

  moveHistory.push({
    player,
    text,
    signature: boardSignature()
  });

  renderMoveHistory();
}


function renderMoveHistory() {
  moveHistoryElement.innerHTML = "";

  if (!moveHistory.length) {
    const empty = document.createElement("li");
    empty.className = "history-empty";
    empty.textContent = "The battle has yet to commence...";
    moveHistoryElement.appendChild(empty);
  } else {
    moveHistory.forEach((entry, index) => {
      const li = document.createElement("li");
      const number = document.createElement("span");
      number.className = "move-number";
      number.textContent = String(index + 1) + ".";

      const detail = document.createElement("span");
      detail.textContent = `${entry.player}: ${entry.text}`;


      li.append(number, detail);
      moveHistoryElement.appendChild(li);
    });

    moveHistoryElement.scrollTop = moveHistoryElement.scrollHeight;
  }

  moveCountElement.textContent =
    `${moveHistory.length} ${moveHistory.length === 1 ? "zet" : "zetten"}`;
}

let gameOverPopup = null;

let board = copyBoard(startingBoard);
const squareTextures = {};
let currentPlayer = "w";
let gameOver = false;
let gameOverReason = "";
let gameOverWinner = null;
let selected = null;
let possibleMoves = [];
let hasMoved = {
  wKing: false,
  bKing: false,
  wRookLeft: false,
  wRookRight: false,
  bRookLeft: false,
  bRookRight: false
};
let enPassantTarget = null;



// Lopers die geschoten hebben moeten eerst bewegen.
let bishopsMustMove = new Set();

// Verborgen mijnen van de torens.
let mines = new Set();

// Damevaardigheid: wanneer een stuk wordt geslagen,
// krijgt de eigenaar van dat stuk de doorbraak voor zijn
// eerstvolgende beurt.
let queenBreakthroughReady = { w: false, b: false };

function copyBoard(source) {
  return source.map(row => [...row]);
}

function pieceColor(piece) {
  return piece ? piece[0] : null;
}

function insideBoard(row, col) {
  return row >= 0 && row < 8 && col >= 0 && col < 8;
}

function squareKey(row, col) {
  return `${row},${col}`;
}

function removePieceAt(row, col) {
  bishopsMustMove.delete(squareKey(row, col));
  board[row][col] = null;
}

// Zoek de positie van de koning van een speler.
function findKing(color) {
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      if (board[row][col] === color + "k") {
        return { row, col };
      }
    }
  }

  return null;
}

// Controleer of de koning wordt aangevallen.

function isKingInCheck(color) {
  const king = findKing(color);
  if (!king) return false;

  const enemyColor = color === "w" ? "b" : "w";

  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const piece = board[row][col];

      if (!piece || piece[0] !== enemyColor) continue;

      const attacks = getBasicMoves(row, col, true);

      for (const move of attacks) {
        if (
          move.row !== king.row ||
          move.col !== king.col
        ) continue;

        // Een schot van een loper wordt niet door een mijn geblokkeerd.
        if (move.action === "shoot") return true;

        // Een mijn blokkeert de gewone aanval van een loper,
        // toren of dame als ze tussen het aanvallende stuk
        // en de koning ligt.
        if (["b", "r", "q"].includes(piece[1])) {
          const path = getPathSquares(
            row,
            col,
            king.row,
            king.col
          );

          const mineBlocksPath = path.some(square =>
            mines.has(squareKey(square.row, square.col))
          );

          if (mineBlocksPath) continue;
        }

        return true;
      }
    }
  }

  return false;
}

function addVeinsToSquare(square, isDark, row, col) {
  const key = `${row}-${col}`;

  if (!squareTextures[key]) {
    const textureIndex = 1 + Math.floor(Math.random() * 5);
    const type = isDark ? "dark" : "light";

    squareTextures[key] = `Images/board_textures/${type}_${textureIndex}.png`;
  }

  square.style.backgroundImage = `url("${squareTextures[key]}")`;
  square.style.backgroundSize = "100% 100%";
  square.style.backgroundPosition = "center";
  square.style.backgroundRepeat = "no-repeat";
}

function renderBoard() {
  boardElement.innerHTML = "";
  if (myColor === "b") {
  boardElement.classList.add("flipped");
} else {
  boardElement.classList.remove("flipped");
}


  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const square = document.createElement("button");
      const piece = board[row][col];

      square.type = "button";
      square.className = `square ${
        (row + col) % 2 === 0 ? "light" : "dark"
      }`;
      const isDark = (row + col) % 2 !== 0;
addVeinsToSquare(square, isDark, row, col);


      square.setAttribute("role", "gridcell");
      square.setAttribute(
        "aria-label",
        `${coordinateName(row, col)}${
          piece ? ", stuk aanwezig" : ""
        }`
      );

      square.title = coordinateName(row, col);

      if (piece) {
        const img = document.createElement("img");
        img.src = pieceImages[piece];
        img.alt = piece;
        img.className = "piece-image";
        square.appendChild(img);
      }

      if (
        selected &&
        selected.row === row &&
        selected.col === col
      ) {
        square.classList.add("selected");
      }

      const move = possibleMoves.find(
        m => m.row === row && m.col === col
      );

      if (move) {
        if (piece) {
          square.classList.add("capture");
        } else {
          square.classList.add("possible");
        }
      }

      square.addEventListener("click", () => {
        handleSquareClick(row, col);
      });

      boardElement.appendChild(square);
    }
  }

    const signature = boardSignature();
  lastBoardSignature = signature;

  updateCapturedPieces();
  renderMoveHistory();

  turnElement.textContent = gameOver
    ? "Spel afgelopen."
    : currentPlayer === "w"
      ? "White's turn."
      : "Black's turn.";

  updateCheckStatus();

  if (currentRoomCode && !applyingRemoteState) {
    void publishGameState();
  }
  if (!currentRoomCode && currentPlayer === "b" && !gameOver) {
  startBotTurn();
}

}


function coordinateName(row, col) {
  return `${"abcdefgh"[col]}${8 - row}`;
  if (currentRoomCode) {
  void publishGameState();
}

}

function isMoveLegalForKing(fromRow, fromCol, move) {
  const piece = board[fromRow][fromCol];

  if (!piece) return false;

  const color = piece[0];
  
  const oldBoard = copyBoard(board);
  const oldMines = new Set(mines);
  const oldBishops = new Set(bishopsMustMove);
  const oldQueenReady = { ...queenBreakthroughReady };

  try {
    const toRow = move.row;
    const toCol = move.col;
    const target = board[toRow][toCol];
    // De koning mag een vijandelijke toren slaan,
// ook als hij daardoor zelf ontploft en verliest.
if (
  piece[1] === "k" &&
  target &&
  target[1] === "r" &&
  target[0] !== color
) {
  return true;
}

    // Een loper die schiet, blijft op zijn plaats.
    if (move.action === "shoot") {
      if (!target || target[0] === color) return false;
      removePieceAt(toRow, toCol);
    } else {
      const path = getPathSquares(
        fromRow,
        fromCol,
        toRow,
        toCol
      );

      if (piece[1] === "r") {
        mines.add(squareKey(fromRow, fromCol));
      }

      const mineOnPath = path.find(square =>
        mines.has(squareKey(square.row, square.col))
      );

      if (mineOnPath) {
        mines.delete(
          squareKey(mineOnPath.row, mineOnPath.col)
        );
        removePieceAt(fromRow, fromCol);
      } else if (mines.has(squareKey(toRow, toCol))) {
        mines.delete(squareKey(toRow, toCol));
        removePieceAt(fromRow, fromCol);
      } else if (
        (piece[1] === "r" && target) ||
        (target && target[1] === "r")
      ) {
        removePieceAt(fromRow, fromCol);
        removePieceAt(toRow, toCol);
      } else {
        if (move.action === "queenBreakthrough") {
          for (const square of path) {
            const occupant = board[square.row][square.col];

            if (occupant && occupant[0] !== color) {
              removePieceAt(square.row, square.col);
            }
          }
        }

        if (move.action === "castle") {
  board[toRow][toCol] = piece;
  board[fromRow][fromCol] = null;

  const rook = board[fromRow][move.rookFromCol];

  board[fromRow][move.rookToCol] = rook;
  board[fromRow][move.rookFromCol] = null;
} else {
  removePieceAt(fromRow, fromCol);
  board[toRow][toCol] = piece;

  if (move.action === "enPassant") {
    const capturedPawnRow =
      toRow - (piece[0] === "w" ? -1 : 1);

    board[capturedPawnRow][toCol] = null;
  }
}

        if (
          (piece === "wp" && toRow === 0) ||
          (piece === "bp" && toRow === 7)
        ) {
          board[toRow][toCol] = color + "q";
        }
      }
    }

    // Een zet mag de eigen koning blootstellen.
// De tegenstander kan hem daarna slaan en het spel winnen.
// Een zet is alleen toegestaan als de eigen koning
// daarna niet meer aangevallen wordt.
return !isKingInCheck(color);
  } finally {
    board = oldBoard;
    mines = oldMines;
    bishopsMustMove = oldBishops;
    queenBreakthroughReady = oldQueenReady;
  }
}


function getLegalMoves(row, col) {
  const piece = board[row][col];
  if (!piece) return [];

  return getBasicMoves(row, col).filter(move => {
    // In War Chess mag een koning worden geslagen.
    // De partij eindigt dan onmiddellijk.
    return isMoveLegalForKing(row, col, move);
  });
}

function isPieceProtected(row, col, color) {
  const protectedPiece = board[row][col];

  if (!protectedPiece || protectedPiece[0] !== color) {
    return false;
  }

  // Tijdelijk doen alsof het beschermde stuk niet op het vakje staat.
  // Zo kunnen lopers, torens en dames het vakje bereiken.
  board[row][col] = null;

  try {
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const piece = board[r][c];

        if (!piece || piece[0] !== color) {
          continue;
        }

        // Pionnen beschermen diagonaal.
        if (piece[1] === "p") {
          const direction = color === "w" ? -1 : 1;

          if (
            r + direction === row &&
            Math.abs(c - col) === 1
          ) {
            return true;
          }

          continue;
        }

        const moves = getBasicMoves(r, c, true);

        if (moves.some(move =>
          move.row === row &&
          move.col === col
        )) {
          return true;
        }
      }
    }

    return false;
  } finally {
    // Het oorspronkelijke stuk terugzetten.
    board[row][col] = protectedPiece;
  }
}


function hasAnyLegalMoves(color) {
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const piece = board[row][col];

      if (!piece || piece[0] !== color) {
        continue;
      }

      if (getLegalMoves(row, col).length > 0) {
        return true;
      }
    }
  }

  return false;
}

function endGame(winnerColor, reason) {
  if (gameOver) return;
  playSound("win")

  gameOver = true;
  gameOverReason = reason;
gameOverWinner = winnerColor;
  const reward = winnerColor === "b" ? 20 : -20;

for (let i = 0; i < aiMovesThisGame.length; i++) {
  // Eerdere zetten krijgen een kleinere beloning.
  const discount = Math.pow(0.9, aiMovesThisGame.length - 1 - i);

  teachAI(
    aiMovesThisGame[i],
    reward * discount
  );
}



  selected = null;
  possibleMoves = [];

  const winnerName = winnerColor === "w" ? "Wit" : "Zwart";
  const loserName = winnerColor === "w" ? "Zwart" : "Wit";

  messageElement.textContent = `${reason} ${winnerName} wint!`;
  turnElement.textContent = "Spel afgelopen.";

  showGameOverPopup(`${winnerName} wint!`, reason);
  void publishGameState();
}

function showGameOverPopup(titleText, reasonText) {
  if (gameOverPopup) gameOverPopup.remove();

  const overlay = document.createElement("div");
  overlay.id = "game-over-popup";
  Object.assign(overlay.style, {
    position: "fixed",
    inset: "0",
    background: "rgba(0, 0, 0, 0.72)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: "9999",
    padding: "20px"
  });

  const panel = document.createElement("div");
  Object.assign(panel.style, {
    background: "#fff",
    color: "#222",
    padding: "28px",
    borderRadius: "14px",
    maxWidth: "420px",
    width: "100%",
    textAlign: "center",
    boxShadow: "0 10px 35px rgba(0,0,0,0.35)",
    fontFamily: "Arial, sans-serif"
  });

  const heading = document.createElement("h2");
  heading.textContent = titleText;
  heading.style.marginTop = "0";

  const reason = document.createElement("p");
  reason.textContent = reasonText;
  reason.style.lineHeight = "1.5";

  const newGameButton = document.createElement("button");
  newGameButton.type = "button";
  newGameButton.textContent = "Nieuw spel";
  Object.assign(newGameButton.style, {
    padding: "11px 16px",
    margin: "8px",
    border: "0",
    borderRadius: "8px",
    cursor: "pointer",
    background: "#246b3c",
    color: "#fff",
    fontSize: "16px"
  });
  newGameButton.addEventListener("click", resetGame);

  const viewBoardButton = document.createElement("button");
  viewBoardButton.type = "button";
  viewBoardButton.textContent = "Bord bekijken";
  Object.assign(viewBoardButton.style, {
    padding: "11px 16px",
    margin: "8px",
    border: "0",
    borderRadius: "8px",
    cursor: "pointer",
    background: "#e5e7eb",
    color: "#222",
    fontSize: "16px"
  });
  viewBoardButton.addEventListener("click", () => {
    overlay.remove();
    gameOverPopup = null;
  });

  panel.append(heading, reason, newGameButton, viewBoardButton);
  overlay.appendChild(panel);
  document.body.appendChild(overlay);
  gameOverPopup = overlay;
}

function updateCheckStatus() {
  if (gameOver) return;

  const inCheck = isKingInCheck(currentPlayer);

  if (inCheck && !hasAnyLegalMoves(currentPlayer)) {
    const winner = currentPlayer === "w" ? "b" : "w";
    endGame(winner, "Schaakmat!");
    return;
  }

  messageElement.textContent = inCheck
    ? `SCHAAK! ${currentPlayer === "w" ? "Wit" : "Zwart"} moet zijn koning beschermen.`
    : "";
}

function handleSquareClick(row, col) {
  if (gameOver) return;
  if (currentRoomCode && currentPlayer !== myColor) {
  multiplayerStatus.textContent = "Wacht op de beurt van de andere speler.";
  return;
}


  const clickedPiece = board[row][col];

  if (selected) {
    const normalMove =
      possibleMoves.find(
        m =>
          m.row === row &&
          m.col === col &&
          m.action === "queenBreakthrough"
      ) ||
      possibleMoves.find(
        m =>
          m.row === row &&
          m.col === col &&
          m.action !== "shoot"
      );

    const shootMove = possibleMoves.find(
      m =>
        m.row === row &&
        m.col === col &&
        m.action === "shoot"
    );

    if (normalMove && shootMove) {
      const shoot = window.confirm(
        "Wil je met de loper SCHIETEN?\n\n" +
        "OK = schieten en blijven staan.\n" +
        "Annuleren = bewegen en het stuk normaal slaan."
      );

      if (shoot) {
        shootPiece(
          selected.row,
          selected.col,
          row,
          col
        );
      } else {
        movePiece(
          selected.row,
          selected.col,
          row,
          col,
          normalMove
        );
      }

      return;
    }

    if (shootMove) {
      shootPiece(
        selected.row,
        selected.col,
        row,
        col
      );
      return;
    }

    if (normalMove) {
      movePiece(
        selected.row,
        selected.col,
        row,
        col,
        normalMove
      );
      return;
    }
  }

  if (
    clickedPiece &&
    pieceColor(clickedPiece) === currentPlayer
  ) {
    selected = { row, col };
    possibleMoves = getLegalMoves(row, col);

    messageElement.textContent =
      `Selected: ${clickedPiece} op ` +
      `${coordinateName(row, col)}.`;
  } else {
    selected = null;
    possibleMoves = [];

    messageElement.textContent =
      "Please choose a piece of the person whose turn it is.";
  }

  renderBoard();
}

async function shootPiece(fromRow, fromCol, toRow, toCol) {
  // 1. Start het schietgeluid direct
  playSound("shoot");

  // 2. Wacht een heel kort moment (300ms) zodat de knal en het wegvallen van het stuk gelijklopen
  await new Promise(resolve => setTimeout(resolve, 1175));

  // 3. Pas daarna pas de logica en het bord aan
  const shooter = board[fromRow][fromCol];
  const target = board[toRow][toCol];
  const movingPlayer = shooter
    ? (shooter[0] === "w" ? "Wit" : "Zwart")
    : "";

  const historyText = shooter && target
    ? `Loper schiet vanaf ${coordinateName(fromRow, fromCol)} op ${coordinateName(toRow, toCol)}`
    : "";

  if (!shooter || shooter[1] !== "b") return;

  if (!target || pieceColor(target) === pieceColor(shooter)) {
    return;
  }

  queenBreakthroughReady[target[0]] = true;

  removePieceAt(toRow, toCol);

  bishopsMustMove.add(squareKey(fromRow, fromCol));

  selected = null;
  possibleMoves = [];

  queenBreakthroughReady[currentPlayer] = false;
  currentPlayer = currentPlayer === "w" ? "b" : "w";

  messageElement.textContent =
    "Shot fired! The bishop has to move " +
    "before he can shoot again.";
  addMoveHistory(historyText, movingPlayer);

  renderBoard();
}

function getPathSquares(fromRow, fromCol, toRow, toCol) {
  const dr = toRow - fromRow;
  const dc = toCol - fromCol;

  const isStraight = dr === 0 || dc === 0;
  const isDiagonal = Math.abs(dr) === Math.abs(dc);

  if (!isStraight && !isDiagonal) {
    return [];
  }

  const stepRow = Math.sign(dr);
  const stepCol = Math.sign(dc);

  const path = [];
  let row = fromRow + stepRow;
  let col = fromCol + stepCol;

  while (row !== toRow || col !== toCol) {
    path.push({ row, col });
    row += stepRow;
    col += stepCol;
  }

  return path;
}
function movePiece(fromRow, fromCol, toRow, toCol, move = null) {
  
const piece = board[fromRow][fromCol];
const target = board[toRow][toCol];

if (!piece) return;

const movingPlayer = piece[0] === "w" ? "Wit" : "Zwart";
const movingPieceName = pieceNames[piece[1]];
const fromSquare = coordinateName(fromRow, fromCol);
const toSquare = coordinateName(toRow, toCol);

const moveDescription = `${movingPieceName} ${fromSquare} → ${toSquare}`;

  const isRook = piece[1] === "r";
  const targetIsRook = target && target[1] === "r";

  const isQueenBreakthrough =
    piece[1] === "q" &&
    move?.action === "queenBreakthrough";

  const capturedPieces = [];

  if (
    isQueenBreakthrough &&
    !queenBreakthroughReady[piece[0]]
  ) {
    return;
  }

  // Elke bewegende toren laat een verborgen mijn achter.
  if (isRook) {
    mines.add(squareKey(fromRow, fromCol));
  }

  const path = getPathSquares(
    fromRow,
    fromCol,
    toRow,
    toCol
  );

  // Controleer de mijnen onderweg.
  for (const square of path) {
    const key = squareKey(square.row, square.col);

    if (mines.has(key)) {
      mines.delete(key);
      playSound("boom");

      if (piece[1] === "q") {
        queenBreakthroughReady[piece[0]] = false;
      }

      removePieceAt(fromRow, fromCol);

      selected = null;
      possibleMoves = [];

      queenBreakthroughReady[currentPlayer] = false;
 if (piece[1] === "p" && Math.abs(toRow - fromRow) === 2) {
  enPassantTarget = {
    row: (fromRow + toRow) / 2,
    col: fromCol
  };
} else {
  enPassantTarget = null;
}


      currentPlayer = currentPlayer === "w" ? "b" : "w";

      messageElement.textContent =
        `Mijn ontploft op ${coordinateName(
          square.row,
          square.col
        )}! Het bewegende stuk is vernietigd.`;
        addMoveHistory(
  `     ${moveDescription} — mijn ontploft op ${coordinateName(square.row, square.col)}; stuk vernietigd`,
        movingPlayer
        );
        
        addMoveHistory(
  `${moveDescription} — mijn ontploft op ${toSquare}; stuk vernietigd`,
  movingPlayer
);

addMoveHistory(
  `${moveDescription} — BOOM! Both the rook and the taken piece got destroyed.`,
  movingPlayer
);

      renderBoard();
      return;
    }
  }
// Als de koning een toren slaat, ontploffen beide.
// Dit geldt ook als er een mijn onder de toren ligt.
if (piece[1] === "k" && targetIsRook) {
  const destinationKey = squareKey(toRow, toCol);

  // Verwijder een mijn onder de toren, als die er ligt.
  mines.delete(destinationKey);

  // Beide stukken worden vernietigd.
  removePieceAt(fromRow, fromCol);
  removePieceAt(toRow, toCol);

  selected = null;
  possibleMoves = [];

  renderBoard();

  // De eigenaar van de toren wint.
  endGame(
    target[0],
    "BOOM! The king exploded by taking a rook."
  );

  renderBoard();
  return;
}

  // Controleer het bestemmingsvakje op een mijn.
  const destinationKey = squareKey(toRow, toCol);

  if (mines.has(destinationKey)) {
    mines.delete(destinationKey);

    if (piece[1] === "q") {
      queenBreakthroughReady[piece[0]] = false;
    }

    removePieceAt(fromRow, fromCol);

    selected = null;
    possibleMoves = [];

    if (piece[1] === "k") {
      renderBoard();
      endGame(
        piece[0] === "w" ? "b" : "w",
        `BOOM! The ${piece[0] === "w" ? "White" : "Black"} king stepped on a mine.`
      );
      renderBoard();
      return;
    }

    queenBreakthroughReady[currentPlayer] = false;
    currentPlayer = currentPlayer === "w" ? "b" : "w";

    messageElement.textContent =
      `Mine exploded on ${coordinateName(toRow, toCol)}! The moved piece explodes.`;

    renderBoard();
    return;
  }

  // Als een toren een stuk slaat, ontploffen beide stukken.
  if (isRook && target) {
    queenBreakthroughReady[target[0]] = true;

    removePieceAt(fromRow, fromCol);
    removePieceAt(toRow, toCol);

    selected = null;
    possibleMoves = [];

    if (target[1] === "k") {
      renderBoard();
      endGame(
        piece[0],
        "BOOM! The king got destroyed by a rook."
      );
      renderBoard();
      return;
    }

    queenBreakthroughReady[currentPlayer] = false;
    currentPlayer = currentPlayer === "w" ? "b" : "w";

    messageElement.textContent =
      "BOOM! Both the rook and the taken piece got destroyed. " +
      "The rook has left a hidden mine.";

    renderBoard();
    return;
  }

  

// Als een toren wordt geslagen, ontploffen beide stukken.
if (targetIsRook) {
    queenBreakthroughReady[target[0]] = true;

    removePieceAt(fromRow, fromCol);
    removePieceAt(toRow, toCol);

    selected = null;
    possibleMoves = [];

    if (piece[1] === "k") {
      renderBoard();
      endGame(
        target[0],
        "BOOM! The king exploded by taking a rook."
      );
      renderBoard();
      return;
    }

    queenBreakthroughReady[currentPlayer] = false;
    currentPlayer = currentPlayer === "w" ? "b" : "w";

    messageElement.textContent =
      "BOOM! The rook and the piece that took it, " +
      "both got destroyed.";

    renderBoard();
    return;
  }
    // Een gewoon stuk dat de koning slaat, wint de partij.
  // De speciale torenregels zijn hierboven al afgehandeld.
  if (target && target[1] === "k") {
    board[toRow][toCol] = piece;
    board[fromRow][fromCol] = null;

    selected = null;
    possibleMoves = [];

    queenBreakthroughReady[currentPlayer] = false;

    renderBoard();

    endGame(
      piece[0],
      `De ${target[0] === "w" ? "witte" : "zwarte"} koning is geslagen.`
    );

    renderBoard();
    return;
  }


  
  // Dame-doorbraak: sla eerst het eerste vijandelijke
  // stuk op de route en daarna eventueel het tweede.
  if (isQueenBreakthrough) {
    const enemiesToCapture = [];

    // getPathSquares geeft de vakjes terug in de juiste
    // volgorde: vanaf de dame naar haar bestemming.
    for (const square of path) {
      const pathPiece = board[square.row][square.col];

      if (pathPiece && pathPiece[0] !== piece[0]) {
        // De koning mag nooit geslagen worden.
        if (pathPiece[1] === "k") {
          return;
        }

        enemiesToCapture.push({
          row: square.row,
          col: square.col,
          piece: pathPiece
        });

        // Maximaal twee vijandelijke stukken.
        if (enemiesToCapture.length === 2) {
          break;
        }
      }
    }

    // Het bestemmingsvakje kan het tweede slachtoffer zijn.
    if (
      target &&
      target[0] !== piece[0] &&
      !enemiesToCapture.some(
        enemy => enemy.row === toRow && enemy.col === toCol
      )
    ) {
      if (target[1] === "k") {
        return;
      }

      enemiesToCapture.push({
        row: toRow,
        col: toCol,
        piece: target
      });
    }

    // Verwijder de slachtoffers in de gevonden volgorde.
    for (const enemy of enemiesToCapture) {
      queenBreakthroughReady[enemy.piece[0]] = true;

      removePieceAt(enemy.row, enemy.col);
      capturedPieces.push(enemy);
    }

    // De doorbraak is nu verbruikt.
    queenBreakthroughReady[piece[0]] = false;

  } else if (target) {
    queenBreakthroughReady[target[0]] = true;
  }

  // Als de loper beweegt, mag hij daarna weer schieten.
  if (piece === "wb" || piece === "bb") {
    bishopsMustMove.delete(squareKey(fromRow, fromCol));
  }

  if (piece === "wk") {
  hasMoved.wKing = true;
}

if (piece === "bk") {
  hasMoved.bKing = true;
}
if (piece === "wr") {
  if (fromRow === 7 && fromCol === 0) {
    hasMoved.wRookLeft = true;
  }

  if (fromRow === 7 && fromCol === 7) {
    hasMoved.wRookRight = true;
  }
}

if (piece === "br") {
  if (fromRow === 0 && fromCol === 0) {
    hasMoved.bRookLeft = true;
  }

  if (fromRow === 0 && fromCol === 7) {
    hasMoved.bRookRight = true;
  }
}

  // Verplaats het stuk.
  board[toRow][toCol] = piece;
  board[fromRow][fromCol] = null;
  if (move?.action === "enPassant") {
  const capturedPawnRow = toRow - (piece[0] === "w" ? -1 : 1);

  board[capturedPawnRow][toCol] = null;
}

  if (move?.action === "castle") {
  const rook = board[fromRow][move.rookFromCol];

  board[fromRow][move.rookToCol] = rook;
  board[fromRow][move.rookFromCol] = null;
  if (piece === "wk") {
  hasMoved.wRookRight = move.rookFromCol === 7;
  hasMoved.wRookLeft = move.rookFromCol === 0;
}

if (piece === "bk") {
  hasMoved.bRookRight = move.rookFromCol === 7;
  hasMoved.bRookLeft = move.rookFromCol === 0;
}

}


  // Een pion wordt een dame als hij de overkant bereikt.
  if (piece === "wp" && toRow === 0) {
    board[toRow][toCol] = "wq";
  }

  if (piece === "bp" && toRow === 7) {
    board[toRow][toCol] = "bq";
  }

  selected = null;
  possibleMoves = [];

  queenBreakthroughReady[currentPlayer] = false;
  if (piece[1] === "p" && Math.abs(toRow - fromRow) === 2) {
    enPassantTarget = {
        row: (fromRow + toRow) / 2,
        col: fromCol
    };
} else {
    enPassantTarget = null;
}

  currentPlayer = currentPlayer === "w" ? "b" : "w";

  messageElement.textContent = isQueenBreakthrough
    ? `The queen has pierced ${capturedPieces.length} piece(s).`
    : target
      ? "Piece taken! Next person's turn."
      : isRook
        ? "The rook leaves a hidden mine."
        : "Move done, next person's turn.";
    
const historyText = isQueenBreakthrough
  ? `${moveDescription} — dame-doorbraak, ${capturedPieces.length} stuk(ken) geslagen`
  : target
    ? `${moveDescription} — slaat ${pieceNames[target[1]]}`
    : (piece[1] === "p" && (toRow === 0 || toRow === 7))
      ? `${moveDescription} — promoveert tot dame`
      : moveDescription;

addMoveHistory(historyText, movingPlayer);
// Speel slag- of zetgeluid af
  playSound(target ? "capture" : "move");

  renderBoard();
}
function isSquareAttacked(row, col, byColor) {
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = board[r][c];

      if (!piece || piece[0] !== byColor) {
        continue;
      }
      if (piece[1] === "p") {
  const direction = piece[0] === "w" ? -1 : 1;

  if (
    r + direction === row &&
    Math.abs(c - col) === 1
  ) {
    return true;
  }

  continue;
}

      const moves = getBasicMoves(r, c, true);

      if (moves.some(move => move.row === row && move.col === col)) {
        return true;
      }
    }
  }

  return false;
}

function getBasicMoves(row, col, skipCastling = false) {
  const piece = board[row][col];
  if (!piece) return [];

  const color = piece[0];
  const type = piece[1];
  const moves = [];

  // Pionnen
  if (type === "p") {
    const direction = color === "w" ? -1 : 1;
    const startRow = color === "w" ? 6 : 1;
    const oneRow = row + direction;

    if (insideBoard(oneRow, col)) {
      const frontPiece = board[oneRow][col];

      if (!frontPiece) {
        moves.push({ row: oneRow, col });

        const twoRow = row + 2 * direction;

        if (
          row === startRow &&
          insideBoard(twoRow, col) &&
          !board[twoRow][col]
        ) {
          moves.push({ row: twoRow, col });
        }
      } else if (pieceColor(frontPiece) !== color) {
        moves.push({ row: oneRow, col });
      }
    }

    // Linksvoor en rechtsvoor aanvallen.
    for (const dc of [-1, 1]) {
      const r = row + direction;
      const c = col + dc;

      if (
        insideBoard(r, c) &&
        board[r][c] &&
        pieceColor(board[r][c]) !== color
      ) {
        moves.push({ row: r, col: c });
      }
      const adjacentPiece = board[row][c];

if (
  enPassantTarget &&
  enPassantTarget.row === r &&
  enPassantTarget.col === c &&
  adjacentPiece === (color === "w" ? "bp" : "wp")
) {

  moves.push({
    row: r,
    col: c,
    action: "enPassant"
  });
}

    }
  }

  // Paarden: normale, korte en lange L-sprongen.
  if (type === "n") {
    const knightMoves = [
      [-2, -1], [-2, 1],
      [2, -1], [2, 1],
      [-1, -2], [1, -2],
      [-1, 2], [1, 2],

      [-1, -1], [-1, 1],
      [1, -1], [1, 1],

      [-3, -1], [-3, 1],
      [3, -1], [3, 1],
      [-1, -3], [1, -3],
      [-1, 3], [1, 3]
    ];

    for (const [dr, dc] of knightMoves) {
      const r = row + dr;
      const c = col + dc;

      if (
        insideBoard(r, c) &&
        pieceColor(board[r][c]) !== color
      ) {
        moves.push({ row: r, col: c });
      }
    }
  }

  // Koningen
  if (type === "k") {
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;

        const r = row + dr;
        const c = col + dc;

        if (
          insideBoard(r, c) &&
          pieceColor(board[r][c]) !== color
        ) {
          moves.push({ row: r, col: c });
        }
      }
    }
    // Rokade naar rechts
if (
  !skipCastling &&
  color === "w" &&
  !hasMoved.wKing &&
  !hasMoved.wRookRight &&
  !isKingInCheck("w")
) {

  if (
    board[7][5] === null &&
    board[7][6] === null &&
    board[7][7] === "wr"
  ) {
    if (
  !isSquareAttacked(7, 5, "b") &&
  !isSquareAttacked(7, 6, "b")
) {
  moves.push({
    row: 7,
    col: 6,
    action: "castle",
    rookFromCol: 7,
    rookToCol: 5
  });
}

  }
}

if (
  !skipCastling &&
  color === "b" &&
  !hasMoved.bKing &&
  !hasMoved.bRookRight &&
  !isKingInCheck("b")
) {

  if (
    board[0][5] === null &&
    board[0][6] === null &&
    board[0][7] === "br"
  ) {
    if (
  !isSquareAttacked(0, 5, "w") &&
  !isSquareAttacked(0, 6, "w")
) {

    moves.push({
      row: 0,
      col: 6,
      action: "castle",
      rookFromCol: 7,
      rookToCol: 5
    });
  }
}
}

// Rokade naar links
if (
  !skipCastling &&
  color === "w" &&
  !hasMoved.wKing &&
  !hasMoved.wRookLeft &&
  !isKingInCheck("w")
) {

  if (
    board[7][1] === null &&
    board[7][2] === null &&
    board[7][3] === null &&
    board[7][0] === "wr"
  ) {
    if (
  !isSquareAttacked(7, 3, "b") &&
  !isSquareAttacked(7, 2, "b")
) {
    moves.push({
      row: 7,
      col: 2,
      action: "castle",
      rookFromCol: 0,
      rookToCol: 3
    });
  }
}
}

if (
  !skipCastling &&
  color === "b" &&
  !hasMoved.bKing &&
  !hasMoved.bRookLeft &&
  !isKingInCheck("b")
) {

  if (
    board[0][1] === null &&
    board[0][2] === null &&
    board[0][3] === null &&
    board[0][0] === "br"
  ) {
    if (
  !isSquareAttacked(0, 3, "w") &&
  !isSquareAttacked(0, 2, "w")
) {
    moves.push({
      row: 0,
      col: 2,
      action: "castle",
      rookFromCol: 0,
      rookToCol: 3
    });
  }
}
}

  }

  // Lopers, torens en dames
  if (["b", "r", "q"].includes(type)) {
    const directions = [];

    if (type === "b" || type === "q") {
      directions.push(
        [-1, -1], [-1, 1],
        [1, -1], [1, 1]
      );
    }

    if (type === "r" || type === "q") {
      directions.push(
        [-1, 0], [1, 0],
        [0, -1], [0, 1]
      );
    }

    const bishopKey = squareKey(row, col);
    const canShoot =
      type !== "b" || !bishopsMustMove.has(bishopKey);

    for (const [dr, dc] of directions) {
      let r = row + dr;
      let c = col + dc;

      while (insideBoard(r, c)) {
        const target = board[r][c];

        if (!target) {
          moves.push({ row: r, col: c });
        } else {
          if (pieceColor(target) !== color) {
            if (type === "b") {
              moves.push({
                row: r,
                col: c,
                action: "capture"
              });

              if (canShoot) {
                moves.push({
                  row: r,
                  col: c,
                  action: "shoot"
                });
              }
            } else {
              moves.push({ row: r, col: c });
            }
          }

          // Dame-doorbraak: dezelfde lijn blijven volgen.
          if (
            type === "q" &&
            queenBreakthroughReady[color] &&
            pieceColor(target) !== color
          ) {
            let nextR = r + dr;
            let nextC = c + dc;

            while (insideBoard(nextR, nextC)) {
              const nextTarget = board[nextR][nextC];

              if (!nextTarget) {
                moves.push({
                  row: nextR,
                  col: nextC,
                  action: "queenBreakthrough"
                });
              } else if (pieceColor(nextTarget) !== color) {
                // De dame mag een koning niet slaan of passeren.
                if (nextTarget[1] === "k") {
                  break;
                }

                moves.push({
                  row: nextR,
                  col: nextC,
                  action: "queenBreakthrough"
                });

                // Maximaal twee stukken per doorbraak.
                break;
              } else {
                // Eigen stukken blokkeren de doorbraak.
                break;
              }

              nextR += dr;
              nextC += dc;
            }
          }

          // Een stuk blokkeert normale zetten.
          break;
        }

        r += dr;
        c += dc;
      }
    }
  }

  return moves;
}

function resetGame() {
  aiMovesThisGame.length = 0;
  if (gameOverPopup) {
    gameOverPopup.remove();
    gameOverPopup = null;
  }

  board = copyBoard(startingBoard);
  currentPlayer = "w";
  gameOver = false;
  gameOverReason = "";
gameOverWinner = null;
  selected = null;
  possibleMoves = [];

  bishopsMustMove.clear();
  mines.clear();
  queenBreakthroughReady = { w: false, b: false };
  hasMoved = {
  wKing: false,
  bKing: false,
  wRookLeft: false,
  wRookRight: false,
  bRookLeft: false,
  bRookRight: false
};
enPassantTarget = null;



  capturedPieces.w = [];
  capturedPieces.b = [];
  moveHistory = [];
  lastRenderedCounts = null;
  lastBoardSignature = null;

  renderMoveHistory();

  messageElement.textContent =
    "Nieuw spel gestart. Wit begint.";

  renderBoard();
}

resetButton.addEventListener("click", resetGame);
renderBoard();

function getAllLegalMoves(color) {
  const moves = [];

  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const piece = board[row][col];

      if (!piece || piece[0] !== color) continue;

      const legalMoves = getLegalMoves(row, col);

      for (const move of legalMoves) {
        moves.push({
          fromRow: row,
          fromCol: col,
          toRow: move.row,
          toCol: move.col,
          action: move.action || null,
          rookFromCol: move.rookFromCol,
          rookToCol: move.rookToCol
        });
      }
    }
  }

  return moves;
}

function getRandomBotMove() {
  const moves = getAllLegalMoves("b");

  if (moves.length === 0) {
    return null;
  }

  // Geef elke zet een score.
  const scoredMoves = moves.map(move => {
    let score = getBotMoveScore(move) + Math.random() * 0.5;

const target = board[move.toRow][move.toCol];

if (target && target[0] === "w") {
  const targetValue = getPieceValue(target);

  // Eerst kijken naar de waarde van het stuk dat wordt geslagen.
  score += targetValue * 5;
}

    // Een stuk pakken is goed...
    if (move.action === "shoot") {
  const target = board[move.toRow][move.toCol];

  // De loper kan veilig op afstand schieten.
  // Hoe waardevoller het doelstuk, hoe interessanter de zet.
  if (target) {
    score += getPieceValue(target) * 2;
  }
}
 if (target && target[0] === "w") {
  const targetValue = getPieceValue(target);
  const attackingPiece = board[move.fromRow][move.fromCol];

  // Een waardevol stuk pakken is goed.
  score += targetValue * 4;

  // Een onbeschermd stuk is extra aantrekkelijk.
  if (!isPieceProtected(
    move.toRow,
    move.toCol,
    "w"
  )) {
    score += 40;
  } else {
    // Beschermde stukken zijn veel minder aantrekkelijk.
    score -= 30;
  }

  // Een toren vernietigt zichzelf ook bij een vangst.
  if (attackingPiece[1] === "r" || target[1] === "r") {
    score -= targetValue * 2;
  }
}



    // ...maar niet als het eigen stuk daarna meteen gepakt kan worden.
    if (!isMoveSafeForBot(move)) {
    score -= getPieceValue(board[move.fromRow][move.fromCol]) * 3;

    if (board[move.toRow][move.toCol]?.[1] === "q") {
        score += 50;
    }
}


    return {
      move,
      score
    };
  });

  // Sorteer van beste naar slechtste zet.
  scoredMoves.sort((a, b) => b.score - a.score);

  // Kies willekeurig uit de 3 beste zetten.
  const capturingMoves = scoredMoves.filter(scored => {
  const target = board[scored.move.toRow][scored.move.toCol];

  return target && target[0] === "w";
});


const safeCapturingMoves = capturingMoves.filter(scored =>
  isMoveSafeForBot(scored.move)
);

const bestMoves =
  safeCapturingMoves.length > 0
    ? safeCapturingMoves.slice(0, Math.min(3, safeCapturingMoves.length))
    : capturingMoves.length > 0
      ? capturingMoves.slice(0, Math.min(3, capturingMoves.length))
      : scoredMoves.slice(0, Math.min(3, scoredMoves.length));

return bestMoves[
  Math.floor(Math.random() * bestMoves.length)
].move;
}

function isMoveSafeForBot(move) {
      const piece = board[move.fromRow][move.fromCol];
      const target = board[move.toRow][move.toCol];

// De zwarte koning verliest als hij een witte toren slaat.
if (
  piece === "bk" &&
  target === "wr"
) {
  return false;
}

    // Controleer of het stuk tijdens zijn beweging door een mijn gaat.
    if (
        piece &&
        piece[1] !== "n" &&
        move.fromRow === move.toRow
    ) {
        const direction = move.toCol > move.fromCol ? 1 : -1;

        for (
            let col = move.fromCol + direction;
            col !== move.toCol;
            col += direction
        ) {
            if (mines.has(squareKey(move.fromRow, col))) {
                return false;
            }
        }
    }

    if (
        piece &&
        piece[1] !== "n" &&
        move.fromCol === move.toCol
    ) {
        const direction = move.toRow > move.fromRow ? 1 : -1;

        for (
            let row = move.fromRow + direction;
            row !== move.toRow;
            row += direction
        ) {
            if (mines.has(squareKey(row, move.fromCol))) {
                return false;
            }
        }
    }

  // De bot mag nooit vrijwillig op een mijn stappen.
  if (mines.has(squareKey(move.toRow, move.toCol))) {
    return false;
  }

  // Bij een schot blijft de loper staan.
// Alleen het doelstuk wordt verwijderd.
if (move.action === "shoot") {
    

    if (!target || target[0] !== "w") {
        return false;
    }

    // Simuleer dat het doelstuk wordt verwijderd.
    board[move.toRow][move.toCol] = null;

    const whiteMoves = getAllLegalMoves("w");

    // Zet het doelstuk terug.
    board[move.toRow][move.toCol] = target;

    // Als wit de loper nu kan pakken, is het schot onveilig.
    return !whiteMoves.some(whiteMove =>
        whiteMove.toRow === move.fromRow &&
        whiteMove.toCol === move.fromCol
    );
}


  const originalPiece = board[move.fromRow][move.fromCol];
  const capturedPiece = board[move.toRow][move.toCol];

  board[move.toRow][move.toCol] = originalPiece;
  board[move.fromRow][move.fromCol] = null;

  const whiteMoves = getAllLegalMoves("w");
  const canBeCaptured = whiteMoves.some(whiteMove =>
    whiteMove.toRow === move.toRow &&
    whiteMove.toCol === move.toCol
);


  board[move.fromRow][move.fromCol] = originalPiece;
  board[move.toRow][move.toCol] = capturedPiece;

  if (canBeCaptured) {
    return false;
}

return true;

}


function getBotMoveScore(move) {
  let score = 0;

  const piece = board[move.fromRow][move.fromCol];
  const target = board[move.toRow][move.toCol];

  if (!piece) return -Infinity;

  const pieceValue = getPieceValue(piece);
  const targetValue = target ? getPieceValue(target) : 0;

  // 1. De vijandelijke koning slaan betekent onmiddellijke winst
  if (target === "wk") {
    return 100000;
  }

  // 2. De zwarte koning mag NIET een witte toren slaan (want dan ontploft de koning)
  if (piece === "bk" && target === "wr") {
    return -100000;
  }

  // 3. BESCHERMING EN VERDEDIGING (Eigen stukken redden door weg te lopen/slaan)
  const isCurrentlyProtected = isPieceProtected(move.fromRow, move.fromCol, "b");
  const isAttackedByWhite = isSquareAttacked(move.fromRow, move.fromCol, "w");

  if (isAttackedByWhite && !isCurrentlyProtected) {
    if (isMoveSafeForBot(move)) {
      score += pieceValue * 15; // Bonus voor het redden van een bedreigd stuk
    }
  }

  // 4. TOREN-ONTPLOFFINGEN (Kijk of de toren een stuk slaat OF geslagen wordt)
  const isRookInvolved = piece[1] === "r" || (target && target[1] === "r");

  if (target && target[0] === "w") {
    if (isRookInvolved) {
      const netValue = targetValue - pieceValue;

      if (netValue > 0) {
        score += netValue * 30; // Goede ruil!
      } else if (netValue < 0) {
        score -= Math.abs(netValue) * 40; // Slechte ruil!
      } else {
        score -= 5;
      }
    } else {
      // Normale aanval:
      const tradeBalance = targetValue - pieceValue;
      if (tradeBalance > 0) {
        score += tradeBalance * 25;
      } else if (tradeBalance < 0) {
        score -= Math.abs(tradeBalance) * 20;
      } else {
        score += targetValue * 15;
      }

      if (!isPieceProtected(move.toRow, move.toCol, "w")) {
        score += 40;
      }
    }
  }

  // 5. Beloon een loper die op afstand schiet
  if (move.action === "shoot" && target) {
    score += targetValue * 15;
  }

  // 6. Beoordeel de stukken die een dame-doorbraak kan slaan
  if (move.action === "queenBreakthrough" && piece[1] === "q") {
    const path = getPathSquares(move.fromRow, move.fromCol, move.toRow, move.toCol);

    for (const square of path) {
      const pathPiece = board[square.row][square.col];

      if (pathPiece && pathPiece[0] === "w") {
        if (pathPiece[1] === "k") {
          score -= 100000;
          break;
        }
        score += getPieceValue(pathPiece) * 12;
      }
    }
  }

  // 7. ACTIEF DEKKEN: Simuleer of deze zet een ANDER zwart stuk gaat beschermen
  const originalPiece = board[move.fromRow][move.fromCol];
  const originalTarget = board[move.toRow][move.toCol];

  // Voer de zet tijdelijk uit
  board[move.toRow][move.toCol] = originalPiece;
  board[move.fromRow][move.fromCol] = null;

  // Controleer of het verplaatste stuk zelf gedekt staat
  if (isPieceProtected(move.toRow, move.toCol, "b")) {
    score += 8;
  }

  // Tel hoeveel extra zwarte stukken nu beschermd zijn
  let extraDefendedPoints = 0;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const otherPiece = board[r][c];
      if (otherPiece && otherPiece[0] === "b" && !(r === move.toRow && c === move.toCol)) {
        // Als dit stuk nu wel beschermd is
        if (isPieceProtected(r, c, "b")) {
          // Extra punten als het stuk ook daadwerkelijk door wit wordt aangevallen!
          if (isSquareAttacked(r, c, "w")) {
            extraDefendedPoints += getPieceValue(otherPiece) * 12;
          } else {
            extraDefendedPoints += 2; // Lichte bonus voor algemene dekking
          }
        }
      }
    }
  }

  score += extraDefendedPoints;

  // Herstel het bord
  board[move.fromRow][move.fromCol] = originalPiece;
  board[move.toRow][move.toCol] = originalTarget;

  // 8. Straf onveilige zetten
  if (!isRookInvolved && !isMoveSafeForBot(move)) {
    score -= pieceValue * 25;
  }

  return score;
}

function getPieceValue(piece) {
  const values = {
    p: 1,
    n: 3,
    b: 3,
    r: 5,
    q: 9,
    k: 100
  };

  return values[piece[1]] || 0;
}


function makeBotMove() {
  const move = getRandomBotMove();

  if (!move) {
    return;
  }

if (move.action === "shoot") {
  shootPiece(
    move.fromRow,
    move.fromCol,
    move.toRow,
    move.toCol
  );
  return;
}

    movePiece(
    move.fromRow,
    move.fromCol,
    move.toRow,
    move.toCol,
    {
      row: move.toRow,
      col: move.toCol,
      action: move.action
    }
  );
}

function startBotTurn() {
  if (gameOver || currentPlayer !== "b") {
    return;
  }

  setTimeout(() => {
    if (!gameOver && currentPlayer === "b") {
      makeLearningAIMove();
    }
  }, 1500);
}

console.log("TEST isPieceProtected:", typeof isPieceProtected);
console.log(
    "Bescherming witte pion:",
    isPieceProtected(6, 0, "w")
);


// Maak een vooraf ingeladen cache aan voor de geluiden
const sounds = {
  move: new Audio("Sounds/move.mp3"),
  capture: new Audio("Sounds/capture.mp3"),
  shoot: new Audio("Sounds/shoot.mp3"),
  boom: new Audio("Sounds/explosion.mp3"),
  win: new Audio("Sounds/win.mp3")
};

// Forceer de browser om alle geluiden direct in te laden bij het opstarten
Object.values(sounds).forEach(sound => {
  sound.load();
});

function playSound(type) {
  const sound = sounds[type];
  if (sound) {
    sound.currentTime = 0;
    sound.play().catch(e => console.log("Audio kon niet worden afgespeeld:", e));
  }
}

function playSoundAsync(type) {
  return new Promise((resolve) => {
    const sound = sounds[type];
    if (!sound) {
      resolve();
      return;
    }
    sound.currentTime = 0;
    
    // Wacht tot het geluid helemaal is afgelopen
    sound.onended = () => {
      resolve();
    };
    
    sound.play().catch(e => {
      console.log("Audio kon niet worden afgespeeld:", e);
      resolve(); // Ga door als er een fout optreedt
    });
  });
}
