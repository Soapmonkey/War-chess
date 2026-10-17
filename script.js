// Mijn schaakvariant - prototype 1


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
    moveHistory
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

    renderBoard();
    

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

      if (!piece || piece[0] !== enemyColor) {
        continue;
      }

      const attacks = getBasicMoves(row, col, true);

      if (
        attacks.some(move =>
          move.row === king.row &&
          move.col === king.col
        )
      ) {
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
    const target = board[move.row][move.col];

    // In schaak wordt de koning niet rechtstreeks geslagen;
    // een aanval op hem betekent schaak.
    if (target && target[1] === "k") return false;

    return isMoveLegalForKing(row, col, move);
  });
}

function hasAnyLegalMoves(color) {
  const rowStart = myColor === "b" ? 7 : 0;
const rowStep = myColor === "b" ? -1 : 1;

const colStart = myColor === "b" ? 7 : 0;
const colStep = myColor === "b" ? -1 : 1;

for (let i = 0; i < 8; i++) {
  const row = rowStart + i * rowStep;

  for (let j = 0; j < 8; j++) {
    const col = colStart + j * colStep;

      const piece = board[row][col];

      if (!piece || piece[0] !== color) continue;

      if (getLegalMoves(row, col).length > 0) return true;
    }
  }

  return false;
}

function endGame(winnerColor, reason) {
  if (gameOver) return;

  gameOver = true;
  selected = null;
  possibleMoves = [];

  const winnerName = winnerColor === "w" ? "Wit" : "Zwart";
  const loserName = winnerColor === "w" ? "Zwart" : "Wit";

  messageElement.textContent = `${reason} ${winnerName} wint!`;
  turnElement.textContent = "Spel afgelopen.";

  showGameOverPopup(`${winnerName} wint!`, reason);
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

function shootPiece(fromRow, fromCol, toRow, toCol) {
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
    "Shot fired! The bishop has to move" +
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

  // Dame-doorbraak: verwijder vijandelijke stukken op de lijn.
  if (isQueenBreakthrough) {
    for (const square of path) {
      const pathPiece = board[square.row][square.col];

      if (pathPiece && pieceColor(pathPiece) !== piece[0]) {
        capturedPieces.push({
          row: square.row,
          col: square.col,
          piece: pathPiece
        });
      }
    }

    if (target && pieceColor(target) !== piece[0]) {
      capturedPieces.push({
        row: toRow,
        col: toCol,
        piece: target
      });
    }

    // De dame mag maximaal twee vijandelijke stukken slaan.
    // Ze mag nooit een koning slaan of door een koning heen gaan.
    if (
      capturedPieces.length > 2 ||
      capturedPieces.some(captured => captured.piece[1] === "k")
    ) {
      return;
    }

    for (const captured of capturedPieces) {
      queenBreakthroughReady[captured.piece[0]] = true;

      removePieceAt(
        captured.row,
        captured.col
      );
    }

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
  if (gameOverPopup) {
    gameOverPopup.remove();
    gameOverPopup = null;
  }

  board = copyBoard(startingBoard);
  currentPlayer = "w";
  gameOver = false;
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
          action: move.action || null
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

  const capturingMoves = moves.filter(isCapturingMove);

if (capturingMoves.length > 0) {
  return capturingMoves[Math.floor(Math.random() * capturingMoves.length)];
}

return moves[Math.floor(Math.random() * moves.length)];
}
function isCapturingMove(move) {
  return board[move.toRow][move.toCol] !== null;
}


function makeBotMove() {
  const move = getRandomBotMove();

  if (!move) {
    return;
  }

  movePiece(
    move.fromRow,
    move.fromCol,
    move.toRow,
    move.toCol
  );
}

function startBotTurn() {
  if (gameOver || currentPlayer !== "b") {
    return;
  }

  setTimeout(() => {
    if (!gameOver && currentPlayer === "b") {
      makeBotMove();
    }
  }, 500);
}
