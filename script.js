// Mijn schaakvariant - prototype 1
console.log("Newest game version. Latest update: shoot sound effect sync. test 4")
const aiMovesThisGame = [];

function getAIStateKey() {
  const boardKey = board.map(row =>
    row.map(piece => piece || "--").join(",")
  ).join("/");

  const minesKey = [...mines.entries()].map(([k, v]) => `${k}:${v}`).sort().join(";");
  const bishopsKey = [...bishopsMustMove].sort().join(";");
  const queenKey = `w:${queenBreakthroughReady.w},b:${queenBreakthroughReady.b}`;
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

  aiMemory[key] = (aiMemory[key] || 0) + reward;

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
    board = copyBoard(originalBoard);
    board[move.toRow][move.toCol] = piece;
    board[move.fromRow][move.fromCol] = null;

    const whiteMoves = getAllLegalMoves("w");

    const canCaptureMovedPiece = whiteMoves.some(reply => {
      if (
        reply.toRow === move.toRow &&
        reply.toCol === move.toCol
      ) {
        return true;
      }

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
      return getPieceValue(piece) * 3;
    }

    return 0;

  } finally {
    board = originalBoard;
  }
}

function getTwoPlyPenalty(move) {
  const piece = board[move.fromRow][move.fromCol];

  if (!piece) return 0;

  const originalBoard = board;

  try {
    board = copyBoard(originalBoard);

    board[move.toRow][move.toCol] = piece;
    board[move.fromRow][move.fromCol] = null;

    const whiteMoves = getAllLegalMoves("w");

    let worstPenalty = 0;

    for (const reply of whiteMoves) {
      const blackTarget = board[reply.toRow][reply.toCol];

      if (blackTarget && blackTarget[0] === "b") {
        const penalty = getPieceValue(blackTarget);
        worstPenalty = Math.max(worstPenalty, penalty);
      }
    }

    return worstPenalty * 2;

  } finally {
    board = originalBoard;
  }
}

function isMoveSafeForBot(move) {
  const piece = board[move.fromRow][move.fromCol];
  const target = board[move.toRow][move.toCol];

  if (!piece) return false;

  if (piece === "bk" && target === "wr") {
    return false;
  }

  if (piece[1] !== "n" && move.fromRow === move.toRow) {
    const direction = move.toCol > move.fromCol ? 1 : -1;
    for (let col = move.fromCol + direction; col !== move.toCol; col += direction) {
      if (mines.has(squareKey(move.fromRow, col))) return false;
    }
  }

  if (piece[1] !== "n" && move.fromCol === move.toCol) {
    const direction = move.toRow > move.fromRow ? 1 : -1;
    for (let row = move.fromRow + direction; row !== move.toRow; row += direction) {
      if (mines.has(squareKey(row, move.fromCol))) return false;
    }
  }

  if (mines.has(squareKey(move.toRow, move.toCol))) {
    return false;
  }

  if (move.action === "shoot") {
    if (!target || target[0] !== "w") return false;

    board[move.toRow][move.toCol] = null;
    const whiteMoves = getAllLegalMoves("w");
    board[move.toRow][move.toCol] = target;

    return !whiteMoves.some(whiteMove =>
      whiteMove.toRow === move.fromRow && whiteMove.toCol === move.fromCol
    );
  }

  const isAttackedByWhite = isSquareAttacked(move.toRow, move.toCol, "w");

  if (isAttackedByWhite) {
    if (piece[1] === "p" && isPieceProtected(move.toRow, move.toCol, "b")) {
      return true;
    }

    if (target) {
      const myVal = getPieceValue(piece);
      const targetVal = getPieceValue(target);

      if (targetVal >= myVal) {
        return true; 
      }
    }
    return false;
  }

  return true;
}

function getBestAIMove(moves) {
  if (moves.length === 0) return null;

  // 1. Kan de AI de koning van de tegenstander pakken?
  const kingCaptures = moves.filter(move => {
    const piece = board[move.fromRow][move.fromCol];
    const target = board[move.toRow][move.toCol];
    return (
      piece && 
      piece[1] === "k" && 
      target && 
      target[0] === "w" && 
      target[1] !== "r" && 
      !isPieceProtected(move.toRow, move.toCol, "w") &&
      !isSquareAttacked(move.toRow, move.toCol, "w")
    );
  });

  if (kingCaptures.length > 0) {
    return kingCaptures[Math.floor(Math.random() * kingCaptures.length)];
  }

  // 2. Filter alleen echt veilige zetten
  const safeMoves = moves.filter(move => isMoveSafeForBot(move));
  const candidateMoves = safeMoves.length > 0 ? safeMoves : moves;

  let bestValue = -Infinity;
  let bestMoves = [];

  for (const move of candidateMoves) {
    const originalBoard = copyBoard(board);
    const originalMines = new Map(mines);
    
    // Bereken basisscore + geleerde kennis
    let moveScore = getBotMoveScore(move) + (getAIMoveValue(move) * 0.25);

    // Geef straf voor zetten die het stuk in direct gevaar brengen (voorkomt roekeloze sacrifices)
    moveScore -= getFutureThreatPenalty(move);

    const target = board[move.toRow][move.toCol];

    if (target && target[0] === "w" && !isPieceProtected(move.toRow, move.toCol, "w")) {
      moveScore += getPieceValue(target) * 100; 
    }

    try {
      simulateMoveForAI(move);

      const whiteLegalMoves = getAllLegalMoves("w");
      let worstWhiteResponse = 0;

      for (const whiteMove of whiteLegalMoves) {
        let threatScore = 0;
        const targetPiece = board[whiteMove.toRow][whiteMove.toCol];
        
        if (targetPiece && targetPiece[0] === "b") {
          threatScore = getPieceValue(targetPiece) * 10;
        }

        if (threatScore > worstWhiteResponse) {
          worstWhiteResponse = threatScore;
        }
      }

      moveScore -= worstWhiteResponse * 1.0;

    } finally {
      board = originalBoard;
      mines = originalMines;
    }

    const finalValue = moveScore + (Math.random() * 0.1);

    if (finalValue > bestValue) {
      bestValue = finalValue;
      bestMoves = [move];
    } else if (finalValue === bestValue) {
      bestMoves.push(move);
    }
  }

  return bestMoves[Math.floor(Math.random() * bestMoves.length)] || moves[0];
}

function simulateMoveForAI(move) {
  const piece = board[move.fromRow][move.fromCol];
  if (!piece) return;

  if (move.action === "shoot") {
    board[move.toRow][move.toCol] = null;
    return;
  }

  board[move.toRow][move.toCol] = piece;
  board[move.fromRow][move.fromCol] = null;
}

function makeLearningAIMove() {
  const moves = getAllLegalMoves("b");

  if (!Array.isArray(moves) || moves.length === 0) return;

  const stateKey = getAIStateKey();

  const move = getBestAIMove(
    moves.map(candidate => ({
      ...candidate,
      stateKey
    }))
  );

  if (!move) return;

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
  onValue
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-database.js";

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
let aiMemory = {};

get(ref(database, "ai/memory")).then(snapshot => {
  if (snapshot.exists()) {
    aiMemory = snapshot.val();
    console.log("AI geheugen succesvol geladen uit Firebase! Aantal opgeslagen geleerde zetten:", Object.keys(aiMemory).length);
  } else {
    console.log("Nog geen AI geheugen gevonden in Firebase, we beginnen vers.");
  }
}).catch(error => {
  console.error("Kon AI geheugen niet laden:", error);
});

let firebaseUser = null;
let applyingRemoteState = false;
let roomListener = null;

const multiplayerStatus = document.querySelector("#multiplayer-status");

signInAnonymously(auth)
  .then(({ user }) => {
    firebaseUser = user;
    multiplayerStatus.textContent = "Connected to Firebase. Create or join a room.";
  })
  .catch(error => {
    console.error("Firebase-aanmelding mislukt:", error);
    multiplayerStatus.textContent = "Firebase kon niet verbinden.";
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
  if (!firebaseUser) return;

  const code = Math.random().toString(36).substring(2, 8).toUpperCase();

  await set(ref(database, `rooms/${code}`), {
    players: { white: firebaseUser.uid, black: null },
    names: { white: playerNameInput.value.trim() || "Speler 1" },
    createdAt: Date.now()
  });

  currentRoomCode = code;
  myColor = "w";
  updatePlayerColor();

  await publishGameState("move");
  listenToRoom();

  multiplayerStatus.textContent = `Kamer aangemaakt! Code: ${code}`;
});

joinRoomButton.addEventListener("click", async () => {
  const code = roomCodeInput.value.trim().toUpperCase();
  if (!code || !firebaseUser) return;

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

  multiplayerStatus.textContent = `You are connected to room ${code}.`;
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

function getGameState(soundType = "move") {
  return {
    board: board.map(row => row.map(piece => piece || "")),
    currentPlayer,
    hasMoved,
    gameOver,
    mines: [...mines.entries()],
    bishopsMustMove: [...bishopsMustMove],
    queenBreakthroughReady,
    enPassantTarget,
    capturedPieces,
    moveHistory,
    gameOverReason,
    gameOverWinner,
    lastActionSound: soundType
  };
}

async function publishGameState(soundType = "move") {
  if (!firebaseUser || !currentRoomCode) return;

  await update(ref(database, `rooms/${currentRoomCode}`), {
    state: getGameState(soundType)
  });
}

function listenToRoom() {
  if (!currentRoomCode) return;

  onValue(ref(database, `rooms/${currentRoomCode}`), snapshot => {
    const room = snapshot.val();
    const state = room?.state;

    if (!state) return;
    whitePlayerElement.textContent = `Wit: ${room.names?.white || "Wachten..."}`;
    blackPlayerElement.textContent = `Zwart: ${room.names?.black || "Wachten..."}`;

    if (
      !Array.isArray(state.board) ||
      state.board.length !== 8 ||
      state.board.some(row => !Array.isArray(row) || row.length !== 8)
    ) {
      return;
    }

    const newBoard = state.board.map(row => row.map(piece => piece || null));
    const newMines = new Map(state.mines || []);

    // Check of de beurt nu bij de andere speler ligt dan wat wij lokaal hadden
    const isEnemyTurnHandled = currentPlayer !== state.currentPlayer;

    board = newBoard;
    currentPlayer = state.currentPlayer;
    gameOver = state.gameOver;
    hasMoved = state.hasMoved || {
      wKing: false, bKing: false,
      wRookLeft: false, wRookRight: false,
      bRookLeft: false, bRookRight: false
    };

    mines = newMines;
    bishopsMustMove = new Set(state.bishopsMustMove || []);
    queenBreakthroughReady = state.queenBreakthroughReady || { w: false, b: false };
    enPassantTarget = state.enPassantTarget || null;

    capturedPieces.w = state.capturedPieces?.w || [];
    capturedPieces.b = state.capturedPieces?.b || [];
    moveHistory = state.moveHistory || [];

    // DIRECTE AUDIO ONTVANGST VOOR ONLINE SPELERS
    // Als de beurt is veranderd én we zijn niet degene die zelf net de actie uittypten:
    if (isEnemyTurnHandled && !applyingRemoteState) {
      console.log("Online geluid ontvangen van tegenstander:", state.lastActionSound);
      
      const soundToPlay = state.lastActionSound || "move";
      
      // Probeer het geluid direct af te spelen
      if (sounds[soundToPlay]) {
        sounds[soundToPlay].currentTime = 0;
        sounds[soundToPlay].play().catch(e => {
          console.log("Audio afspelen geblokkeerd door browser:", e);
        });
      }
    }

    applyingRemoteState = true;
    try {
      gameOverReason = state.gameOverReason || "";
      gameOverWinner = state.gameOverWinner || null;
      renderBoard();
    } finally {
      applyingRemoteState = false;
    }

    if (gameOver && !gameOverPopup) {
      const winnerName = gameOverWinner === "w" ? "Wit" : "Zwart";
      showGameOverPopup(
        `${winnerName} wint!`,
        gameOverReason || "Het spel is afgelopen."
      );
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

  moveCountElement.textContent = `${moveHistory.length} ${moveHistory.length === 1 ? "zet" : "zetten"}`;
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
  wKing: false, bKing: false,
  wRookLeft: false, wRookRight: false,
  bRookLeft: false, bRookRight: false
};
let enPassantTarget = null;

let bishopsMustMove = new Set();
let mines = new Map();
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
        if (move.row !== king.row || move.col !== king.col) continue;

        if (move.action === "shoot") return true;

        if (["b", "r", "q"].includes(piece[1])) {
          const path = getPathSquares(row, col, king.row, king.col);
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
      square.className = `square ${(row + col) % 2 === 0 ? "light" : "dark"}`;
      const isDark = (row + col) % 2 !== 0;
      addVeinsToSquare(square, isDark, row, col);

      const key = squareKey(row, col);
      const mineOwner = mines.get(key);
      const playerSide = currentRoomCode ? myColor : "w";

      if (mineOwner && mineOwner === playerSide) {
        square.classList.add("my-mine");
      }

      square.setAttribute("role", "gridcell");
      square.setAttribute("aria-label", `${coordinateName(row, col)}${piece ? ", stuk aanwezig" : ""}`);
      square.title = coordinateName(row, col);

      if (piece) {
        const img = document.createElement("img");
        img.src = pieceImages[piece];
        img.alt = piece;
        img.className = "piece-image";
        square.appendChild(img);
      }

      if (selected && selected.row === row && selected.col === col) {
        square.classList.add("selected");
      }

      const move = possibleMoves.find(m => m.row === row && m.col === col);
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

  lastBoardSignature = boardSignature();

  updateCapturedPieces();
  renderMoveHistory();

  turnElement.textContent = gameOver
    ? "Spel afgelopen."
    : currentPlayer === "w"
      ? "White's turn."
      : "Black's turn.";

  updateCheckStatus();

  if (!currentRoomCode && currentPlayer === "b" && !gameOver) {
    startBotTurn();
  }
}

function coordinateName(row, col) {
  return `${"abcdefgh"[col]}${8 - row}`;
}

function isMoveLegalForKing(fromRow, fromCol, move) {
  const piece = board[fromRow][fromCol];
  if (!piece) return false;

  const color = piece[0];
  const oldBoard = copyBoard(board);
  const oldMines = new Map(mines);
  const oldBishops = new Set(bishopsMustMove);
  const oldQueenReady = { ...queenBreakthroughReady };

  try {
    const toRow = move.row;
    const toCol = move.col;
    const target = board[toRow][toCol];

    if (
      piece[1] === "k" &&
      target &&
      target[1] === "r" &&
      target[0] !== color
    ) {
      return true;
    }

    if (move.action === "shoot") {
      if (!target || target[0] === color) return false;
      removePieceAt(toRow, toCol);
    } else {
      const path = getPathSquares(fromRow, fromCol, toRow, toCol);

      if (piece[1] === "r") {
        mines.set(squareKey(fromRow, fromCol), piece[0]);
      }

      const mineOnPath = path.find(square =>
        mines.has(squareKey(square.row, square.col))
      );

      if (mineOnPath) {
        mines.delete(squareKey(mineOnPath.row, mineOnPath.col));
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
            const capturedPawnRow = toRow - (piece[0] === "w" ? -1 : 1);
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
    return isMoveLegalForKing(row, col, move);
  });
}

function isPieceProtected(row, col, color) {
  const protectedPiece = board[row][col];

  if (!protectedPiece || protectedPiece[0] !== color) {
    return false;
  }

  board[row][col] = null;

  try {
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const piece = board[r][c];

        if (!piece || piece[0] !== color) continue;

        if (piece[1] === "p") {
          const direction = color === "w" ? -1 : 1;
          if (r + direction === row && Math.abs(c - col) === 1) {
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
  } finally {
    board[row][col] = protectedPiece;
  }
}

function hasAnyLegalMoves(color) {
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const piece = board[row][col];
      if (!piece || piece[0] !== color) continue;

      if (getLegalMoves(row, col).length > 0) {
        return true;
      }
    }
  }
  return false;
}

function isInsufficientMaterial() {
  let pieces = [];
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (p) pieces.push(p);
    }
  }

  if (pieces.some(p => ['p', 'r', 'q'].includes(p[1]))) return false;
  if (pieces.length === 2) return true;
  if (pieces.length === 3) {
    const nonKings = pieces.filter(p => p[1] !== 'k');
    if (nonKings.length === 1 && ['b', 'n'].includes(nonKings[0][1])) return true;
  }
  return false;
}

function endGame(winnerColor, reason) {
  if (gameOver) return;
  
  if (winnerColor) {
    playSound("win");
  }

  gameOver = true;
  gameOverReason = reason;
  gameOverWinner = winnerColor;

  if (winnerColor !== null) {
    const reward = winnerColor === "b" ? 20 : -20;

    for (let i = 0; i < aiMovesThisGame.length; i++) {
      const discount = Math.pow(0.9, aiMovesThisGame.length - 1 - i);
      teachAI(aiMovesThisGame[i], reward * discount);
    }
  }

  selected = null;
  possibleMoves = [];

  const titleText = winnerColor 
    ? `${winnerColor === "w" ? "Wit" : "Zwart"} wint!` 
    : "Remise!";

  messageElement.textContent = `${reason} ${titleText}`;
  turnElement.textContent = "Spel afgelopen.";

  showGameOverPopup(titleText, reason);
  void publishGameState("win");
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

  const incomingCheck = isKingInCheck(currentPlayer);

  if (incomingCheck && !hasAnyLegalMoves(currentPlayer)) {
    const winner = currentPlayer === "w" ? "b" : "w";
    endGame(winner, "Schaakmat!");
    return;
  }

  if (!incomingCheck && !hasAnyLegalMoves(currentPlayer)) {
    endGame(null, "Pat! Geen legale zetten meer mogelijk.");
    return;
  }

  if (isInsufficientMaterial()) {
    endGame(null, "Remise door onvoldoende materiaal!");
    return;
  }

  messageElement.textContent = incomingCheck
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
        m => m.row === row && m.col === col && m.action === "queenBreakthrough"
      ) ||
      possibleMoves.find(
        m => m.row === row && m.col === col && m.action !== "shoot"
      );

    const shootMove = possibleMoves.find(
      m => m.row === row && m.col === col && m.action === "shoot"
    );

    if (normalMove && shootMove) {
      const shoot = window.confirm(
        "Wil je met de loper SCHIETEN?\n\n" +
        "OK = schieten en blijven staan.\n" +
        "Annuleren = bewegen en het stuk normaal slaan."
      );

      if (shoot) {
        shootPiece(selected.row, selected.col, row, col);
      } else {
        movePiece(selected.row, selected.col, row, col, normalMove);
      }

      return;
    }

    if (shootMove) {
      shootPiece(selected.row, selected.col, row, col);
      return;
    }

    if (normalMove) {
      movePiece(selected.row, selected.col, row, col, normalMove);
      return;
    }
  }

  if (clickedPiece && pieceColor(clickedPiece) === currentPlayer) {
    selected = { row, col };
    possibleMoves = getLegalMoves(row, col);

    messageElement.textContent =
      `Selected: ${clickedPiece} op ${coordinateName(row, col)}.`;
  } else {
    selected = null;
    possibleMoves = [];

    messageElement.textContent =
      "Please choose a piece of the person whose turn it is.";
  }

  renderBoard();
}

async function shootPiece(fromRow, fromCol, toRow, toCol) {
  const shooter = board[fromRow][fromCol];
  const target = board[toRow][toCol];

  if (!shooter || shooter[1] !== "b") return;
  if (!target || pieceColor(target) === pieceColor(shooter)) return;

  // 1. Speel het schietgeluid direct af op beide computers
  playSound("shoot");

  // 2. Bepaal de vertraging op basis van de spelmodus:
  // - Speel je online? Dan is een kortere vertraging handig omdat de netwerk-tijd er al bij komt.
  // - Speel je tegen de AI? Dan kun je hier de gewenste langere vertraging aanhouden.
  const delayTime = currentRoomCode ? 3000 : 1175; 

  await new Promise(resolve => setTimeout(resolve, delayTime));

  const movingPlayer = shooter[0] === "w" ? "Wit" : "Zwart";
  const historyText = `Loper schiet vanaf ${coordinateName(fromRow, fromCol)} op ${coordinateName(toRow, toCol)}`;

  // 3. Pas het bord aan nadat de vertraging voorbij is
  queenBreakthroughReady[target[0]] = true;
  removePieceAt(toRow, toCol);
  bishopsMustMove.add(squareKey(fromRow, fromCol));

  selected = null;
  possibleMoves = [];

  queenBreakthroughReady[currentPlayer] = false;
  currentPlayer = currentPlayer === "w" ? "b" : "w";

  messageElement.textContent = "Shot fired! The bishop has to move before he can shoot again.";
  addMoveHistory(historyText, movingPlayer);

  // 4. Render het bord
  renderBoard();

  // 5. Stuur door naar Firebase als je online speelt
  await publishGameState("shoot");
}


function getPathSquares(fromRow, fromCol, toRow, toCol) {
  const dr = toRow - fromRow;
  const dc = toCol - fromCol;

  const isStraight = dr === 0 || dc === 0;
  const isDiagonal = Math.abs(dr) === Math.abs(dc);

  if (!isStraight && !isDiagonal) return [];

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

async function movePiece(fromRow, fromCol, toRow, toCol, move = null) {
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
  const isQueenBreakthrough = piece[1] === "q" && move?.action === "queenBreakthrough";

  const capturedPiecesArr = [];

  if (isQueenBreakthrough && !queenBreakthroughReady[piece[0]]) return;

  if (isRook) {
    mines.set(squareKey(fromRow, fromCol), piece[0]);
  }

  const path = getPathSquares(fromRow, fromCol, toRow, toCol);

  // Check mijnen op pad
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
        enPassantTarget = { row: (fromRow + toRow) / 2, col: fromCol };
      } else {
        enPassantTarget = null;
      }

      currentPlayer = currentPlayer === "w" ? "b" : "w";

      messageElement.textContent = `Mijn ontploft op ${coordinateName(square.row, square.col)}!`;
      addMoveHistory(`${moveDescription} — mijn ontploft op ${coordinateName(square.row, square.col)}`, movingPlayer);

      renderBoard();
      await publishGameState("boom");
      return;
    }
  }

  if (piece[1] === "k" && targetIsRook) {
    const destinationKey = squareKey(toRow, toCol);
    mines.delete(destinationKey);
    playSound("boom");

    removePieceAt(fromRow, fromCol);
    removePieceAt(toRow, toCol);

    selected = null;
    possibleMoves = [];

    renderBoard();
    endGame(target[0], "BOOM! The king exploded by taking a rook.");
    renderBoard();
    await publishGameState("boom");
    return;
  }

  const destinationKey = squareKey(toRow, toCol);

  // Check mijn op eindbestemming
  if (mines.has(destinationKey)) {
    mines.delete(destinationKey);
    playSound("boom");

    if (piece[1] === "q") {
      queenBreakthroughReady[piece[0]] = false;
    }

    removePieceAt(fromRow, fromCol);

    selected = null;
    possibleMoves = [];

    if (piece[1] === "k") {
      renderBoard();
      endGame(piece[0] === "w" ? "b" : "w", "BOOM! King stepped on a mine.");
      renderBoard();
      await publishGameState("boom");
      return;
    }

    queenBreakthroughReady[currentPlayer] = false;
    currentPlayer = currentPlayer === "w" ? "b" : "w";

    messageElement.textContent = `Mine exploded on ${coordinateName(toRow, toCol)}!`;

    renderBoard();
    await publishGameState("boom");
    return;
  }

  // Toren slaat stuk of wordt geslagen
  if (isRook && target) {
    playSound("boom");
    queenBreakthroughReady[target[0]] = true;

    removePieceAt(fromRow, fromCol);
    removePieceAt(toRow, toCol);

    selected = null;
    possibleMoves = [];

    if (target[1] === "k") {
      renderBoard();
      endGame(piece[0], "BOOM! King destroyed by a rook.");
      renderBoard();
      await publishGameState("boom");
      return;
    }

    queenBreakthroughReady[currentPlayer] = false;
    currentPlayer = currentPlayer === "w" ? "b" : "w";

    messageElement.textContent = "BOOM! Rook and taken piece destroyed.";

    renderBoard();
    await publishGameState("boom");
    return;
  }

  if (targetIsRook) {
    playSound("boom");
    queenBreakthroughReady[target[0]] = true;

    removePieceAt(fromRow, fromCol);
    removePieceAt(toRow, toCol);

    selected = null;
    possibleMoves = [];

    if (piece[1] === "k") {
      renderBoard();
      endGame(target[0], "BOOM! King exploded by taking a rook.");
      renderBoard();
      await publishGameState("boom");
      return;
    }

    queenBreakthroughReady[currentPlayer] = false;
    currentPlayer = currentPlayer === "w" ? "b" : "w";

    messageElement.textContent = "BOOM! Rook and capturing piece destroyed.";

    renderBoard();
    await publishGameState("boom");
    return;
  }

  if (target && target[1] === "k") {
    board[toRow][toCol] = piece;
    board[fromRow][fromCol] = null;

    selected = null;
    possibleMoves = [];

    queenBreakthroughReady[currentPlayer] = false;

    renderBoard();
    endGame(piece[0], `De ${target[0] === "w" ? "witte" : "zwarte"} koning is geslagen.`);
    renderBoard();
    await publishGameState("capture");
    return;
  }

  if (isQueenBreakthrough) {
    const enemiesToCapture = [];

    for (const square of path) {
      const pathPiece = board[square.row][square.col];

      if (pathPiece && pathPiece[0] !== piece[0]) {
        if (pathPiece[1] === "k") return;

        enemiesToCapture.push({
          row: square.row,
          col: square.col,
          piece: pathPiece
        });

        if (enemiesToCapture.length === 2) break;
      }
    }

    if (
      target &&
      target[0] !== piece[0] &&
      !enemiesToCapture.some(enemy => enemy.row === toRow && enemy.col === toCol)
    ) {
      if (target[1] === "k") return;

      enemiesToCapture.push({
        row: toRow,
        col: toCol,
        piece: target
      });
    }

    for (const enemy of enemiesToCapture) {
      queenBreakthroughReady[enemy.piece[0]] = true;
      removePieceAt(enemy.row, enemy.col);
      capturedPiecesArr.push(enemy);
    }

    queenBreakthroughReady[piece[0]] = false;

  } else if (target) {
    queenBreakthroughReady[target[0]] = true;
  }

  if (piece === "wb" || piece === "bb") {
    bishopsMustMove.delete(squareKey(fromRow, fromCol));
  }

  if (piece === "wk") hasMoved.wKing = true;
  if (piece === "bk") hasMoved.bKing = true;
  if (piece === "wr") {
    if (fromRow === 7 && fromCol === 0) hasMoved.wRookLeft = true;
    if (fromRow === 7 && fromCol === 7) hasMoved.wRookRight = true;
  }
  if (piece === "br") {
    if (fromRow === 0 && fromCol === 0) hasMoved.bRookLeft = true;
    if (fromRow === 0 && fromCol === 7) hasMoved.bRookRight = true;
  }

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

  if (piece === "wp" && toRow === 0) board[toRow][toCol] = "wq";
  if (piece === "bp" && toRow === 7) board[toRow][toCol] = "bq";

  selected = null;
  possibleMoves = [];

  queenBreakthroughReady[currentPlayer] = false;
  if (piece[1] === "p" && Math.abs(toRow - fromRow) === 2) {
    enPassantTarget = { row: (fromRow + toRow) / 2, col: fromCol };
  } else {
    enPassantTarget = null;
  }

  currentPlayer = currentPlayer === "w" ? "b" : "w";

  messageElement.textContent = isQueenBreakthrough
    ? `The queen has pierced pieces.`
    : target
      ? "Piece taken!"
      : isRook
        ? "The rook leaves a hidden mine."
        : "Move done.";

  const historyText = isQueenBreakthrough
    ? `${moveDescription} — dame-doorbraak`
    : target
      ? `${moveDescription} — slaat ${pieceNames[target[1]]}`
      : moveDescription;

  addMoveHistory(historyText, movingPlayer);

  const didCapture = target || move?.action === "enPassant" || isQueenBreakthrough;
  const actionSound = didCapture ? "capture" : "move";
  playSound(actionSound);

  renderBoard();
  await publishGameState(actionSound);
}

function isSquareAttacked(row, col, byColor) {
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = board[r][c];
      if (!piece || piece[0] !== byColor) continue;

      if (piece[1] === "p") {
        const direction = piece[0] === "w" ? -1 : 1;
        if (r + direction === row && Math.abs(c - col) === 1) return true;
        continue;
      }

      const moves = getBasicMoves(r, c, true);
      if (moves.some(move => move.row === row && move.col === col)) return true;
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

  if (type === "p") {
    const direction = color === "w" ? -1 : 1;
    const startRow = color === "w" ? 6 : 1;
    const oneRow = row + direction;

    if (insideBoard(oneRow, col)) {
      const frontPiece = board[oneRow][col];
      if (!frontPiece) {
        moves.push({ row: oneRow, col });
        const twoRow = row + 2 * direction;
        if (row === startRow && insideBoard(twoRow, col) && !board[twoRow][col]) {
          moves.push({ row: twoRow, col });
        }
      } else if (pieceColor(frontPiece) !== color) {
        moves.push({ row: oneRow, col });
      }
    }

    for (const dc of [-1, 1]) {
      const r = row + direction;
      const c = col + dc;

      if (insideBoard(r, c) && board[r][c] && pieceColor(board[r][c]) !== color) {
        moves.push({ row: r, col: c });
      }

      const adjacentPiece = board[row][c];
      if (
        enPassantTarget &&
        enPassantTarget.row === r &&
        enPassantTarget.col === c &&
        adjacentPiece === (color === "w" ? "bp" : "wp")
      ) {
        moves.push({ row: r, col: c, action: "enPassant" });
      }
    }
  }

  if (type === "n") {
    const knightMoves = [
      [-2, -1], [-2, 1], [2, -1], [2, 1],
      [-1, -2], [1, -2], [-1, 2], [1, 2],
      [-1, -1], [-1, 1], [1, -1], [1, 1],
      [-3, -1], [-3, 1], [3, -1], [3, 1],
      [-1, -3], [1, -3], [-1, 3], [1, 3]
    ];

    for (const [dr, dc] of knightMoves) {
      const r = row + dr;
      const c = col + dc;
      if (insideBoard(r, c) && pieceColor(board[r][c]) !== color) {
        moves.push({ row: r, col: c });
      }
    }
  }

  if (type === "k") {
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const r = row + dr;
        const c = col + dc;
        if (insideBoard(r, c) && pieceColor(board[r][c]) !== color) {
          moves.push({ row: r, col: c });
        }
      }
    }

    if (!skipCastling && color === "w" && !hasMoved.wKing && !hasMoved.wRookRight && !isKingInCheck("w")) {
      if (board[7][5] === null && board[7][6] === null && board[7][7] === "wr") {
        if (!isSquareAttacked(7, 5, "b") && !isSquareAttacked(7, 6, "b")) {
          moves.push({ row: 7, col: 6, action: "castle", rookFromCol: 7, rookToCol: 5 });
        }
      }
    }

    if (!skipCastling && color === "b" && !hasMoved.bKing && !hasMoved.bRookRight && !isKingInCheck("b")) {
      if (board[0][5] === null && board[0][6] === null && board[0][7] === "br") {
        if (!isSquareAttacked(0, 5, "w") && !isSquareAttacked(0, 6, "w")) {
          moves.push({ row: 0, col: 6, action: "castle", rookFromCol: 7, rookToCol: 5 });
        }
      }
    }

    if (!skipCastling && color === "w" && !hasMoved.wKing && !hasMoved.wRookLeft && !isKingInCheck("w")) {
      if (board[7][1] === null && board[7][2] === null && board[7][3] === null && board[7][0] === "wr") {
        if (!isSquareAttacked(7, 3, "b") && !isSquareAttacked(7, 2, "b")) {
          moves.push({ row: 7, col: 2, action: "castle", rookFromCol: 0, rookToCol: 3 });
        }
      }
    }

    if (!skipCastling && color === "b" && !hasMoved.bKing && !hasMoved.bRookLeft && !isKingInCheck("b")) {
      if (board[0][1] === null && board[0][2] === null && board[0][3] === null && board[0][0] === "br") {
        if (!isSquareAttacked(0, 3, "w") && !isSquareAttacked(0, 2, "w")) {
          moves.push({ row: 0, col: 2, action: "castle", rookFromCol: 0, rookToCol: 3 });
        }
      }
    }
  }

  if (["b", "r", "q"].includes(type)) {
    const directions = [];
    if (type === "b" || type === "q") directions.push([-1, -1], [-1, 1], [1, -1], [1, 1]);
    if (type === "r" || type === "q") directions.push([-1, 0], [1, 0], [0, -1], [0, 1]);

    const bishopKey = squareKey(row, col);
    const canShoot = type !== "b" || !bishopsMustMove.has(bishopKey);

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
              moves.push({ row: r, col: c, action: "capture" });
              if (canShoot) moves.push({ row: r, col: c, action: "shoot" });
            } else {
              moves.push({ row: r, col: c });
            }
          }

          if (type === "q" && queenBreakthroughReady[color] && pieceColor(target) !== color) {
            let nextR = r + dr;
            let nextC = c + dc;

            while (insideBoard(nextR, nextC)) {
              const nextTarget = board[nextR][nextC];
              if (!nextTarget) {
                moves.push({ row: nextR, col: nextC, action: "queenBreakthrough" });
              } else if (pieceColor(nextTarget) !== color) {
                if (nextTarget[1] === "k") break;
                moves.push({ row: nextR, col: nextC, action: "queenBreakthrough" });
                break;
              } else {
                break;
              }
              nextR += dr;
              nextC += dc;
            }
          }
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
    wKing: false, bKing: false,
    wRookLeft: false, wRookRight: false,
    bRookLeft: false, bRookRight: false
  };
  enPassantTarget = null;

  capturedPieces.w = [];
  capturedPieces.b = [];
  moveHistory = [];
  lastRenderedCounts = null;
  lastBoardSignature = null;

  renderMoveHistory();
  messageElement.textContent = "Nieuw spel gestart. Wit begint.";
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
  if (moves.length === 0) return null;

  const kingCaptures = moves.filter(move => {
    const piece = board[move.fromRow][move.fromCol];
    const target = board[move.toRow][move.toCol];
    return piece && piece[1] === "k" && target && target[0] === "w" && target[1] !== "r";
  });

  if (kingCaptures.length > 0) {
    return kingCaptures[Math.floor(Math.random() * kingCaptures.length)];
  }

  const scoredMoves = moves.map(move => {
    let score = getBotMoveScore(move) + Math.random() * 0.5;
    const target = board[move.toRow][move.toCol];

    if (target && target[0] === "w") {
      const targetValue = getPieceValue(target);
      score += targetValue * 5;
    }

    if (!isMoveSafeForBot(move)) {
      score -= getPieceValue(board[move.fromRow][move.fromCol]) * 40;
    }

    return { move, score };
  });

  scoredMoves.sort((a, b) => b.score - a.score);

  const capturingMoves = scoredMoves.filter(scored => {
    const target = board[scored.move.toRow][scored.move.toCol];
    return target && target[0] === "w";
  });

  const safeCapturingMoves = capturingMoves.filter(scored => isMoveSafeForBot(scored.move));

  const bestMoves =
    safeCapturingMoves.length > 0
      ? safeCapturingMoves.slice(0, Math.min(3, safeCapturingMoves.length))
      : capturingMoves.length > 0
        ? capturingMoves.slice(0, Math.min(3, capturingMoves.length))
        : scoredMoves.slice(0, Math.min(3, scoredMoves.length));

  return bestMoves[Math.floor(Math.random() * bestMoves.length)].move;
}

function getBotMoveScore(move) {
  let score = 0;
  const piece = board[move.fromRow][move.fromCol];
  const target = board[move.toRow][move.toCol];

  if (!piece) return -Infinity;

  const pieceValue = getPieceValue(piece);
  const targetValue = target ? getPieceValue(target) : 0;

  if (target === "wk") return 100000;
  if (piece === "bk" && target === "wr") return -100000;

  const originalPiece = board[move.fromRow][move.fromCol];
  const originalTarget = board[move.toRow][move.toCol];

  board[move.toRow][move.toCol] = originalPiece;
  board[move.fromRow][move.fromCol] = null;

  try {
    const causesCheck = isKingInCheck("w");
    const whiteKing = findKing("w");

    if (causesCheck) {
      const whiteMovesAfterCheck = getAllLegalMoves("w");
      if (whiteMovesAfterCheck.length === 0) {
        score += 90000;
      } else {
        if (isMoveSafeForBot(move)) {
          score += 150 + (8 - whiteMovesAfterCheck.length) * 20;
        } else {
          score -= 10000;
        }
      }
    }
    
    if (whiteKing) {
      const centerDistance = Math.abs(3.5 - whiteKing.row) + Math.abs(3.5 - whiteKing.col);
      score += centerDistance * 20; 
      const distanceToWhiteKing = Math.abs(move.toRow - whiteKing.row) + Math.abs(move.toCol - whiteKing.col);
      score += (14 - distanceToWhiteKing) * 10;
    }
  } finally {
    board[move.fromRow][move.fromCol] = originalPiece;
    board[move.toRow][move.toCol] = originalTarget;
  }

  const isRookInvolved = piece[1] === "r" || (target && target[1] === "r");

  if (target && target[0] === "w") {
    if (isRookInvolved) {
      const netValue = targetValue - pieceValue;
      if (netValue > 0) score += netValue * 30;
      else score -= Math.abs(netValue) * 40;
    } else {
      const tradeBalance = targetValue - pieceValue;
      if (tradeBalance > 0) score += tradeBalance * 25;
      else score -= Math.abs(tradeBalance) * 20;
    }
  }

  if (!isRookInvolved && !isMoveSafeForBot(move)) {
    const safetyPenalty = Math.max(pieceValue * 40, 150);
    score -= safetyPenalty;
  }

  if (piece[1] === "p" && !isMoveSafeForBot(move)) {
    score -= 50;
  }

  return score;
}

function getPieceValue(piece) {
  if (!piece) return 0;
  const values = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };
  return values[piece[1]] || 0;
}

function makeBotMove() {
  const move = getRandomBotMove();
  if (!move) return;

  if (move.action === "shoot") {
    shootPiece(move.fromRow, move.fromCol, move.toRow, move.toCol);
    return;
  }

  movePiece(
    move.fromRow, move.fromCol, move.toRow, move.toCol,
    { row: move.toRow, col: move.toCol, action: move.action }
  );
}

function startBotTurn() {
  if (gameOver || currentPlayer !== "b") return;

  setTimeout(() => {
    if (!gameOver && currentPlayer === "b") {
      makeLearningAIMove();
    }
  }, 1500);
}

const sounds = {
  move: new Audio("Sounds/move.mp3"),
  capture: new Audio("Sounds/capture.mp3"),
  shoot: new Audio("Sounds/shoot.mp3"),
  boom: new Audio("Sounds/explosion.mp3"),
  win: new Audio("Sounds/win.mp3")
};

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

// Ontgrendel audio bij de eerste interactie met de pagina
document.addEventListener("click", () => {
  Object.values(sounds).forEach(sound => {
    sound.play().then(() => {
      sound.pause();
      sound.currentTime = 0;
    }).catch(() => {});
  });
}, { once: true });
