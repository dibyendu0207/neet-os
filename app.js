/* =========================================================
   NEET OS — FINAL app.js

   CALENDAR:
   Date / Week / Day change at 00:00

   STUDY DAY:
   Progress / Tasks / Study Time reset at 03:00

   00:00–02:59 = previous study day's progress
   03:00        = new study day's progress
========================================================= */

const tasks = [
  {
    name: "Physics Class",
    start: "08:45",
    end: "11:00",
    type: "class",
    subject: "Physics"
  },
  {
    name: "Biology Class",
    start: "11:00",
    end: "13:00",
    type: "class",
    subject: "Biology"
  },
  {
    name: "Chemistry Class",
    start: "13:15",
    end: "15:30",
    type: "class",
    subject: "Chemistry"
  },
  {
    name: "Physics Questions",
    start: "15:45",
    end: "16:30",
    type: "questions",
    subject: "Physics",
    target: 30
  },
  {
    name: "Chemistry Revision + Questions",
    start: "18:50",
    end: "20:50",
    type: "revision",
    subject: "Chemistry",
    target: 50
  },
  {
    name: "Biology Revision + NCERT + Class Questions",
    start: "21:00",
    end: "22:30",
    type: "biology",
    subject: "Biology"
  },
  {
    name: "Physics Question Practice",
    start: "23:00",
    end: "00:30",
    type: "questions",
    subject: "Physics",
    target: 50
  },
  {
    name: "Daily Repair",
    start: "00:30",
    end: "02:00",
    type: "repair",
    subject: "Mixed"
  }
];


/* =========================================================
   STORAGE
========================================================= */

const STORAGE_KEY = "neetOSStudyData";
const HISTORY_KEY = "neetOSHistory";
const SETTINGS_KEY = "neetOSSettings";
const SYLLABUS_KEY = "neetOSSyllabus";

const VERSION = 3;
const PLAN_START = "2026-09-14";

let data = null;
let activeStudyDayKey = null;
let rolloverLock = false;
let pendingTaskIndex = null;
let initialized = false;


/* =========================================================
   HELPERS
========================================================= */

const $ = id => document.getElementById(id);

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[c]));
}

function dateKey(date = new Date()) {
  return (
    date.getFullYear() +
    "-" +
    String(date.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(date.getDate()).padStart(2, "0")
  );
}

function parseDate(key) {
  const [y, m, d] = String(key).split("-").map(Number);
  return new Date(y, m - 1, d);
}


/* =========================================================
   DATE SYSTEM
========================================================= */

/*
   Calendar date:
   Changes exactly at midnight.
*/
function calendarDayKey() {
  return dateKey(new Date());
}


/*
   Study day:
   00:00–02:59 belongs to previous study day.
   At 03:00 new study day starts.
*/
function getStudyDayKey() {
  const d = new Date();

  if (d.getHours() < 3) {
    d.setDate(d.getDate() - 1);
  }

  return dateKey(d);
}


/*
   Week / Day is based on CALENDAR DATE,
   therefore it changes at 00:00.
*/
function dayNumber(key) {
  const diff =
    Math.floor(
      (parseDate(key) - parseDate(PLAN_START)) / 86400000
    ) + 1;

  return Math.max(1, diff);
}


function updateDateHeader() {
  /*
     IMPORTANT:
     This uses calendarDayKey(), NOT getStudyDayKey().

     So:
     14 Sep 11:59 PM -> 14 Sep
     15 Sep 12:00 AM -> 15 Sep

     But progress still belongs to previous study day
     until 03:00 AM.
  */

  const key = calendarDayKey();
  const d = parseDate(key);

  const day = dayNumber(key);
  const week = Math.ceil(day / 7);

  const dateElement = $("todayDate");

  if (dateElement) {
    dateElement.textContent =
      d.toLocaleDateString("en-IN", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric"
      });
  }

  document.querySelectorAll(".day-badge").forEach(element => {
    element.textContent =
      `Week ${week} • Day ${day}`;
  });
}


/* =========================================================
   TIME HELPERS
========================================================= */

function timeToMinutes(time) {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function getCurrentMinutes() {
  const d = new Date();

  return d.getHours() * 60 + d.getMinutes();
}

function formatRange(task) {
  return `${task.start} – ${task.end}`;
}

function formatTimer(seconds) {
  seconds = Math.max(
    0,
    Math.floor(Number(seconds) || 0)
  );

  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;

  return (
    String(h).padStart(2, "0") +
    ":" +
    String(m).padStart(2, "0") +
    ":" +
    String(s).padStart(2, "0")
  );
}

function shortDuration(seconds) {
  seconds = Math.max(
    0,
    Math.floor(Number(seconds) || 0)
  );

  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);

  return (
    h +
    "h " +
    String(m).padStart(2, "0") +
    "m"
  );
}


/* =========================================================
   TASK WINDOW
========================================================= */

function isTaskInWindow(task) {
  const now = getCurrentMinutes();

  const start = timeToMinutes(task.start);
  const end = timeToMinutes(task.end);

  /*
     Normal task:
     08:45 -> 11:00
  */

  if (end > start) {
    return now >= start && now < end;
  }

  /*
     Overnight task:
     23:00 -> 00:30
     00:30 -> 02:00
  */

  return now >= start || now < end;
}


/* =========================================================
   DATA
========================================================= */

function createFreshData() {
  return {
    version: VERSION,
    date: getStudyDayKey(),

    completed: {},

    studySeconds: {},

    taskMeta: {},

    questionCounts: {},

    missedReasons: {},

    repairLog: [],

    sleep: null,

    activeTask: null,

    activeStartTime: null,

    sundayTest: null
  };
}


/* =========================================================
   HISTORY
========================================================= */

function getHistory() {
  try {
    const value =
      JSON.parse(
        localStorage.getItem(HISTORY_KEY) || "[]"
      );

    return Array.isArray(value) ? value : [];

  } catch {
    return [];
  }
}


function saveHistory(history) {
  localStorage.setItem(
    HISTORY_KEY,
    JSON.stringify(history.slice(-180))
  );
}


function createSnapshot(currentData) {
  if (!currentData || !currentData.date) {
    return null;
  }

  const snapshot =
    JSON.parse(
      JSON.stringify(currentData)
    );

  snapshot.activeTask = null;
  snapshot.activeStartTime = null;

  snapshot.totalStudySeconds =
    tasks.reduce(
      (sum, _, index) =>
        sum +
        Number(
          currentData.studySeconds?.[index] || 0
        ),
      0
    );

  snapshot.totalQuestions =
    Object.values(
      currentData.questionCounts || {}
    ).reduce(
      (sum, value) =>
        sum + Number(value || 0),
      0
    );

  snapshot.completedCount =
    tasks.reduce(
      (sum, _, index) =>
        sum +
        (currentData.completed?.[index]
          ? 1
          : 0),
      0
    );

  return snapshot;
}


function archiveStudyDay(currentData) {
  const snapshot =
    createSnapshot(currentData);

  if (!snapshot) return;

  const history = getHistory();

  const existingIndex =
    history.findIndex(
      item =>
        item &&
        item.date === snapshot.date
    );

  if (existingIndex >= 0) {
    history[existingIndex] = snapshot;
  } else {
    history.push(snapshot);
  }

  history.sort(
    (a, b) =>
      String(a.date).localeCompare(
        String(b.date)
      )
  );

  saveHistory(history);
}


/* =========================================================
   LOAD / SAVE
========================================================= */

function loadData() {
  const raw =
    localStorage.getItem(STORAGE_KEY);

  const currentStudyDay =
    getStudyDayKey();

  if (!raw) {
    return createFreshData();
  }

  try {
    const saved =
      JSON.parse(raw);

    /*
       If saved data belongs to an old
       study day, archive it and start new.
    */

    if (
      !saved ||
      saved.date !== currentStudyDay
    ) {
      archiveStudyDay(saved);

      return createFreshData();
    }

    return {
      ...createFreshData(),
      ...saved,

      completed:
        saved.completed || {},

      studySeconds:
        saved.studySeconds || {},

      taskMeta:
        saved.taskMeta || {},

      questionCounts:
        saved.questionCounts || {},

      missedReasons:
        saved.missedReasons || {},

      repairLog:
        saved.repairLog || []
    };

  } catch (error) {
    console.error(
      "NEET OS storage error:",
      error
    );

    return createFreshData();
  }
}


function saveData() {
  if (!data) return;

  data.version = VERSION;

  /*
     IMPORTANT:
     Data date always represents STUDY DAY,
     not calendar date.
  */

  data.date = getStudyDayKey();

  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(data)
    );
  } catch (error) {
    console.error(
      "Could not save NEET OS data:",
      error
    );
  }
}


/* =========================================================
   03:00 PROGRESS ROLLOVER
========================================================= */

function checkDailyRollover() {
  if (!data || rolloverLock) {
    return;
  }

  const currentStudyDay =
    getStudyDayKey();

  if (activeStudyDayKey === null) {
    activeStudyDayKey =
      currentStudyDay;

    return;
  }

  /*
     No reset at midnight.
  */

  if (
    currentStudyDay ===
    activeStudyDayKey
  ) {
    return;
  }

  /*
     New study day starts at 03:00.
  */

  rolloverLock = true;

  try {
    archiveStudyDay(data);

    data =
      createFreshData();

    activeStudyDayKey =
      currentStudyDay;

    saveData();

    updateDateHeader();

    renderTasks();

    updateProgress();

    updateStats();

  } finally {
    rolloverLock = false;
  }
}


/* =========================================================
   STUDY TIME
========================================================= */

function getTaskStudySeconds(index) {
  let seconds =
    Number(
      data?.studySeconds?.[index] || 0
    );

  if (
    data?.activeTask === index &&
    data?.activeStartTime
  ) {
    const elapsed =
      Math.floor(
        (Date.now() -
          data.activeStartTime) /
          1000
      );

    seconds += Math.max(
      0,
      elapsed
    );
  }

  return seconds;
}


function getTotalStudySeconds() {
  return tasks.reduce(
    (sum, _, index) =>
      sum +
      getTaskStudySeconds(index),
    0
  );
}


function getTotalQuestions() {
  return Object.values(
    data?.questionCounts || {}
  ).reduce(
    (sum, value) =>
      sum + Number(value || 0),
    0
  );
}


/* =========================================================
   TASK CARDS
========================================================= */

function getTaskCard(button) {
  return button.closest(
    ".task-card, .task-item, [data-task-index]"
  );
}


function ensureScheduleCards() {
  let buttons =
    [
      ...document.querySelectorAll(
        ".start-button"
      )
    ];

  /*
     If HTML has fewer cards than tasks,
     clone the last card.
  */

  while (
    buttons.length <
    tasks.length
  ) {
    const lastButton =
      buttons.at(-1);

    const lastCard =
      lastButton &&
      getTaskCard(lastButton);

    if (!lastCard) {
      break;
    }

    const clone =
      lastCard.cloneNode(true);

    clone
      .querySelectorAll("[id]")
      .forEach(
        element =>
          element.removeAttribute("id")
      );

    lastCard.parentElement.appendChild(
      clone
    );

    buttons =
      [
        ...document.querySelectorAll(
          ".start-button"
        )
      ];
  }

  buttons.forEach(
    (button, index) => {
      const task =
        tasks[index];

      const card =
        getTaskCard(button);

      if (!task || !card) {
        return;
      }

      const title =
        card.querySelector(
          ".task-title"
        );

      const time =
        card.querySelector(
          ".task-time, .task-schedule, .schedule-time"
        );

      const meta =
        card.querySelector(
          ".task-meta"
        );

      if (title) {
        title.textContent =
          task.name;
      }

      if (time) {
        time.textContent =
          formatRange(task);
      }

      if (
        meta &&
        index === 6
      ) {
        meta.textContent =
          "Minimum 50 Questions";
      }
    }
  );
}


/* =========================================================
   RENDER TASKS
========================================================= */

function renderTasks() {
  ensureScheduleCards();

  document
    .querySelectorAll(
      ".start-button"
    )
    .forEach(
      (button, index) => {
        const task =
          tasks[index];

        const card =
          getTaskCard(button);

        if (!task || !card) {
          return;
        }

        card
          .querySelector(
            ".live-timer"
          )
          ?.remove();

        /*
           ACTIVE
        */

        if (
          data.activeTask ===
          index
        ) {
          button.disabled = false;

          button.textContent =
            "Stop";

          button.style.opacity =
            "1";

          button.style.cursor =
            "pointer";

          const info =
            card.querySelector(
              ".task-info"
            ) || card;

          const timer =
            document.createElement(
              "div"
            );

          timer.className =
            "live-timer";

          timer.id =
            "timer-" + index;

          timer.textContent =
            formatTimer(
              getTaskStudySeconds(
                index
              )
            );

          info.appendChild(
            timer
          );

          return;
        }

        /*
           COMPLETED
        */

        if (
          data.completed[index]
        ) {
          button.disabled =
            true;

          button.textContent =
            "✓ Done";

          button.style.opacity =
            "0.65";

          button.style.cursor =
            "default";

          return;
        }

        /*
           NOT COMPLETED
        */

        const allowed =
          isTaskInWindow(task);

        button.disabled =
          !allowed;

        button.textContent =
          "Start";

        button.style.opacity =
          allowed
            ? "1"
            : "0.45";

        button.style.cursor =
          allowed
            ? "pointer"
            : "not-allowed";

        button.title =
          allowed
            ? "Start session"
            : "Available only during " +
              formatRange(task);
      }
    );
}


/* =========================================================
   SESSION MODAL
========================================================= */

function getSessionModal() {
  return (
    $("sessionModal") ||
    $("taskModal")
  );
}


function closeTaskModal() {
  const modal =
    getSessionModal();

  if (modal) {
    modal.style.display =
      "none";
  }

  pendingTaskIndex = null;
}


function openTaskModal(index) {
  const modal =
    getSessionModal();

  if (!modal) {
    alert(
      "Session popup is missing from index.html."
    );

    return false;
  }

  const task =
    tasks[index];

  pendingTaskIndex =
    index;

  if ($("modalTitle")) {
    $("modalTitle").textContent =
      task.name;
  }

  if ($("modalTaskTime")) {
    $("modalTaskTime").textContent =
      formatRange(task);
  }

  const chapterSelect =
    $("chapterSelect");

  const chapterFinished =
    $("chapterFinished");

  const classOptions =
    $("classOptions");

  const selfStudyOptions =
    $("selfStudyOptions");

  const questionTarget =
    $("questionTarget");

  const minimumQuestions =
    $("minimumQuestions");

  const startButton =
    $("modalStartButton");

  /*
     Restore previous chapter info.
  */

  if (chapterSelect) {
    chapterSelect.value =
      data.taskMeta?.[index]?.chapter ||
      "";
  }

  if (chapterFinished) {
    chapterFinished.checked =
      !!data.taskMeta?.[index]?.finished;
  }

  /*
     Class popup
  */

  if (classOptions) {
    classOptions.style.display =
      task.type === "class"
        ? "block"
        : "none";
  }

  /*
     Self-study popup
  */

  if (selfStudyOptions) {
    selfStudyOptions.style.display =
      task.type === "class"
        ? "none"
        : "block";
  }

  /*
     Question target
  */

  if (minimumQuestions) {
    minimumQuestions.textContent =
      task.target
        ? `Minimum ${task.target} Questions`
        : "No fixed question target";
  }

  if (questionTarget) {
    questionTarget.value = "";
  }

  if (startButton) {
    startButton.disabled =
      task.type === "class" &&
      !chapterSelect?.value;
  }

  modal.style.display =
    "flex";

  return true;
}


/* =========================================================
   MODAL SETUP
========================================================= */

function setupModal() {
  const modal =
    getSessionModal();

  const close =
    $("modalClose");

  const chapterSelect =
    $("chapterSelect");

  const chapterFinished =
    $("chapterFinished");

  const startButton =
    $("modalStartButton");

  close?.addEventListener(
    "click",
    closeTaskModal
  );

  modal?.addEventListener(
    "click",
    event => {
      if (
        event.target === modal
      ) {
        closeTaskModal();
      }
    }
  );

  chapterSelect?.addEventListener(
    "change",
    () => {
      if (startButton) {
        startButton.disabled =
          !chapterSelect.value;
      }
    }
  );

  startButton?.addEventListener(
    "click",
    () => {
      if (
        pendingTaskIndex ===
        null
      ) {
        return;
      }

      const index =
        pendingTaskIndex;

      const task =
        tasks[index];

      const chapter =
        chapterSelect?.value.trim() ||
        "";

      /*
         Class requires chapter.
      */

      if (
        task.type === "class" &&
        !chapter
      ) {
        alert(
          "Please select a chapter first."
        );

        return;
      }

      if (chapter) {
        data.taskMeta[index] = {
          ...(data.taskMeta[index] || {}),

          chapter,

          finished:
            !!chapterFinished?.checked
        };
      }

      closeTaskModal();

      actuallyStartTask(index);
    }
  );
}


/* =========================================================
   START / STOP
========================================================= */

function actuallyStartTask(index) {
  if (
    data.activeTask !== null &&
    data.activeTask !== index
  ) {
    alert(
      "Another study task is already running."
    );

    return;
  }

  data.activeTask =
    index;

  data.activeStartTime =
    Date.now();

  data.completed[index] =
    false;

  saveData();

  renderTasks();

  updateProgress();
}


function startTask(
  index,
  ignoreTime = false
) {
  const task =
    tasks[index];

  if (!task) {
    return;
  }

  if (
    data.activeTask !== null &&
    data.activeTask !== index
  ) {
    alert(
      "Another study task is already running."
    );

    return;
  }

  /*
     Normal UI:
     must be inside scheduled window.

     Test API:
     ignoreTime = true.
  */

  if (
    !ignoreTime &&
    !isTaskInWindow(task)
  ) {
    alert(
      `This task can only be started during its scheduled time.\n\n` +
      `${task.name}\n` +
      `${formatRange(task)}`
    );

    return;
  }

  if (
    data.activeTask === index
  ) {
    return;
  }

  /*
     Popup for classes and
     question/revision sessions.
  */

  if (
    task.type === "class" ||
    task.type === "questions" ||
    task.type === "revision" ||
    task.type === "biology"
  ) {
    openTaskModal(index);

    return;
  }

  actuallyStartTask(index);
}


/*
   Stop session.

   For target-based tasks:
   Ask:
   "Target achieved?"

   Yes:
   target number is saved.

   No:
   ask actual questions solved.
*/

function stopTask(index) {
  if (
    data.activeTask !== index
  ) {
    return;
  }

  const elapsed =
    data.activeStartTime
      ? Math.max(
          0,
          Math.floor(
            (Date.now() -
              data.activeStartTime) /
              1000
          )
        )
      : 0;

  data.studySeconds[index] =
    Number(
      data.studySeconds[index] ||
        0
    ) + elapsed;

  data.activeTask =
    null;

  data.activeStartTime =
    null;

  const task =
    tasks[index];

  /*
     Question target
  */

  if (task.target) {
    const achieved =
      confirm(
        `Target achieved?\n\n` +
        `${task.name}\n` +
        `Target: ${task.target} questions\n\n` +
        `OK = Yes\n` +
        `Cancel = No`
      );

    if (achieved) {
      data.questionCounts[index] =
        Math.max(
          Number(
            data.questionCounts[index] ||
              0
          ),
          task.target
        );

    } else {
      const actual =
        prompt(
          "How many questions did you actually solve?",
          "0"
        );

      const number =
        Math.max(
          0,
          Number.parseInt(
            actual || "0",
            10
          ) || 0
        );

      data.questionCounts[index] =
        number;
    }
  }

  data.completed[index] =
    true;

  saveData();

  renderTasks();

  updateProgress();

  updateStats();
}


/* =========================================================
   TASK BUTTON EVENTS
========================================================= */

function setupTaskButtons() {
  document
    .querySelectorAll(
      ".start-button"
    )
    .forEach(
      (button, index) => {
        if (
          button.dataset.neetosBound
        ) {
          return;
        }

        button.dataset.neetosBound =
          "1";

        button.addEventListener(
          "click",
          event => {
            event.preventDefault();
            event.stopPropagation();

            if (
              data.activeTask ===
              index
            ) {
              stopTask(index);

            } else {
              startTask(index);
            }
          }
        );
      }
    );
}


/* =========================================================
   PROGRESS
========================================================= */

function updateProgress() {
  const completed =
    tasks.reduce(
      (sum, _, index) =>
        sum +
        (data.completed[index]
          ? 1
          : 0),
      0
    );

  const percentage =
    Math.round(
      (completed /
        tasks.length) *
        100
    );

  const studySeconds =
    getTotalStudySeconds();

  const questions =
    getTotalQuestions();

  if ($("progressPercent")) {
    $("progressPercent").textContent =
      percentage + "%";
  }

  if ($("taskProgress")) {
    $("taskProgress").textContent =
      `${completed} / ${tasks.length}`;
  }

  if ($("taskProgressBar")) {
    $("taskProgressBar").style.width =
      percentage + "%";
  }

  /*
     12 hour visual study-time bar.
  */

  if ($("studyProgress")) {
    $("studyProgress").style.width =
      Math.min(
        100,
        Math.round(
          (studySeconds /
            (12 * 3600)) *
            100
        )
      ) + "%";
  }

  if ($("studyTime")) {
    $("studyTime").textContent =
      shortDuration(
        studySeconds
      );
  }

  if ($("questionProgress")) {
    $("questionProgress").textContent =
      `${questions} / 180`;
  }
}


/* =========================================================
   STATS
========================================================= */

function updateStats() {
  const studySeconds =
    getTotalStudySeconds();

  const completed =
    tasks.filter(
      (_, index) =>
        data.completed[index]
    ).length;

  const questions =
    getTotalQuestions();

  if ($("statsStudyTime")) {
    $("statsStudyTime").textContent =
      shortDuration(
        studySeconds
      );
  }

  if ($("statsTasks")) {
    $("statsTasks").textContent =
      `${completed} / ${tasks.length}`;
  }

  if ($("statsQuestions")) {
    $("statsQuestions").textContent =
      questions;
  }

  document
    .querySelectorAll(
      "#statsSection .stat-row-page"
    )
    .forEach(row => {
      const label =
        (
          row.querySelector(
            "span"
          )?.textContent || ""
        ).toLowerCase();

      const value =
        row.querySelector(
          "strong"
        );

      if (!value) {
        return;
      }

      if (
        label === "physics"
      ) {
        const seconds =
          tasks.reduce(
            (sum, task, index) =>
              sum +
              (
                task.subject ===
                "Physics"
                  ? getTaskStudySeconds(
                      index
                    )
                  : 0
              ),
            0
          );

        value.textContent =
          shortDuration(
            seconds
          );
      }

      if (
        label === "chemistry"
      ) {
        const seconds =
          tasks.reduce(
            (sum, task, index) =>
              sum +
              (
                task.subject ===
                "Chemistry"
                  ? getTaskStudySeconds(
                      index
                    )
                  : 0
              ),
            0
          );

        value.textContent =
          shortDuration(
            seconds
          );
      }

      if (
        label === "biology"
      ) {
        const seconds =
          tasks.reduce(
            (sum, task, index) =>
              sum +
              (
                task.subject ===
                "Biology"
                  ? getTaskStudySeconds(
                      index
                    )
                  : 0
              ),
            0
          );

        value.textContent =
          shortDuration(
            seconds
          );
      }
    });
}


/* =========================================================
   SYLLABUS
========================================================= */

const SYLLABUS = {

  Physics: [
    "Physics and Measurement",
    "Kinematics",
    "Laws of Motion",
    "Work, Energy and Power",
    "Rotational Motion",
    "Gravitation",
    "Properties of Solids and Liquids",
    "Thermodynamics",
    "Kinetic Theory of Gases",
    "Oscillations and Waves",
    "Electrostatics",
    "Current Electricity",
    "Magnetic Effects of Current and Magnetism",
    "Electromagnetic Induction and Alternating Currents",
    "Electromagnetic Waves",
    "Optics",
    "Dual Nature of Matter and Radiation",
    "Atoms and Nuclei",
    "Electronic Devices",
    "Experimental Skills"
  ],

  "Physical Chemistry": [
    "Some Basic Concepts of Chemistry",
    "Atomic Structure",
    "Chemical Thermodynamics",
    "Solutions",
    "Equilibrium",
    "Redox Reactions and Electrochemistry",
    "Chemical Kinetics"
  ],

  "Inorganic Chemistry": [
    "Classification of Elements and Periodicity in Properties",
    "P-Block Elements",
    "d- and f-Block Elements",
    "Coordination Compounds"
  ],

  "Organic Chemistry": [
    "Purification and Characterisation of Organic Compounds",
    "Some Basic Principles of Organic Chemistry",
    "Hydrocarbons",
    "Organic Compounds Containing Halogens",
    "Organic Compounds Containing Oxygen",
    "Organic Compounds Containing Nitrogen",
    "Biomolecules",
    "Principles Related to Practical Chemistry"
  ],

  Botany: [
    "The Living World",
    "Biological Classification",
    "Plant Kingdom",
    "Morphology of Flowering Plants",
    "Anatomy of Flowering Plants",
    "Cell: The Unit of Life",
    "Biomolecules",
    "Transport in Plants",
    "Mineral Nutrition",
    "Photosynthesis in Plants",
    "Respiration in Plants",
    "Plant Growth and Development",
    "Sexual Reproduction in Flowering Plants",
    "Principles of Inheritance and Variation",
    "Molecular Basis of Inheritance",
    "Evolution",
    "Plant Biotechnology: Principles and Processes",
    "Biotechnology and Its Applications",
    "Organisms and Populations",
    "Ecosystem",
    "Biodiversity and Conservation"
  ],

  Zoology: [
    "Animal Kingdom",
    "Structural Organisation in Animals",
    "Cell Cycle and Cell Division",
    "Human Digestive System",
    "Breathing and Exchange of Gases",
    "Body Fluids and Circulation",
    "Excretory Products and Their Elimination",
    "Locomotion and Movement",
    "Neural Control and Coordination",
    "Chemical Coordination and Integration",
    "Human Reproduction",
    "Reproductive Health",
    "Human Health and Disease",
    "Evolution",
    "Animal Husbandry",
    "Microbes in Human Welfare",
    "Biotechnology and Its Applications",
    "Organisms and Populations",
    "Ecosystem",
    "Biodiversity and Conservation"
  ]
};


function getSyllabusState() {
  try {
    return JSON.parse(
      localStorage.getItem(
        SYLLABUS_KEY
      ) || "{}"
    );
  } catch {
    return {};
  }
}


function renderSyllabus() {
  const section =
    $("syllabusSection");

  if (!section) {
    return;
  }

  const state =
    getSyllabusState();

  /*
     Remove old generated
     syllabus cards first.
  */

  section
    .querySelectorAll(
      ".neetos-syllabus-card"
    )
    .forEach(
      card => card.remove()
    );

  Object.entries(
    SYLLABUS
  ).forEach(
    ([subject, chapters]) => {
      const card =
        document.createElement(
          "div"
        );

      card.className =
        "simple-card neetos-syllabus-card";

      const heading =
        document.createElement(
          "h3"
        );

      heading.textContent =
        subject;

      card.appendChild(
        heading
      );

      chapters.forEach(
        (chapter, index) => {
          const key =
            subject +
            "::" +
            chapter;

          const row =
            document.createElement(
              "button"
            );

          row.type =
            "button";

          row.className =
            "chapter-row";

          row.style.width =
            "100%";

          row.style.background =
            "none";

          row.style.color =
            "inherit";

          row.innerHTML =
            `
              <span>
                ${index + 1}. ${esc(chapter)}
              </span>

              <span class="badge">
                ${state[key] ? "✓" : "○"}
              </span>
            `;

          row.addEventListener(
            "click",
            () => {
              const current =
                getSyllabusState();

              current[key] =
                !current[key];

              localStorage.setItem(
                SYLLABUS_KEY,
                JSON.stringify(
                  current
                )
              );

              renderSyllabus();
            }
          );

          card.appendChild(
            row
          );
        }
      );

      section.appendChild(
        card
      );
    }
  );
}


/* =========================================================
   PAGE NAVIGATION
========================================================= */

function showSection(name) {
  const target =
    String(name || "home")
      .toLowerCase();

  const pages =
    document.querySelectorAll(
      ".app-page[data-section]"
    );

  pages.forEach(
    page => {
      const active =
        (
          page.dataset.section ||
          ""
        ).toLowerCase() ===
        target;

      page.classList.toggle(
        "active-page",
        active
      );

      page.classList.toggle(
        "active",
        active
      );

      page.style.display =
        active
          ? "block"
          : "none";
    }
  );

  document
    .querySelectorAll(
      ".nav-item"
    )
    .forEach(
      button => {
        const page =
          (
            button.dataset.page ||
            button.dataset.nav ||
            ""
          ).toLowerCase();

        button.classList.toggle(
          "active",
          page === target
        );
      }
    );

  window.scrollTo({
    top: 0,
    behavior: "smooth"
  });

  if (
    target === "stats"
  ) {
    updateStats();
  }

  if (
    target === "syllabus"
  ) {
    renderSyllabus();
  }
}


function setupNavigation() {
  document
    .querySelectorAll(
      ".bottom-nav .nav-item"
    )
    .forEach(
      button => {
        if (
          button.dataset.neetosNav
        ) {
          return;
        }

        button.dataset.neetosNav =
          "1";

        button.addEventListener(
          "click",
          event => {
            event.preventDefault();
            event.stopPropagation();

            showSection(
              button.dataset.page ||
              button.dataset.nav
            );
          }
        );
      }
    );
}


/* =========================================================
   CUSTOM MODAL STYLE
========================================================= */

function addCustomStyle() {
  if ($("neetOSStyle")) {
    return;
  }

  const style =
    document.createElement(
      "style"
    );

  style.id =
    "neetOSStyle";

  style.textContent = `

    .neetos-click {
      cursor: pointer;
    }

    .neetos-click:hover {
      filter: brightness(1.08);
    }

    .neetos-overlay {
      position: fixed;
      inset: 0;
      z-index: 99999;
      background: rgba(0,0,0,.76);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 18px;
    }

    .neetos-box {
      width: min(620px,96vw);
      max-height: 88vh;
      overflow: auto;
      background: #0b1a2b;
      color: #fff;
      border: 1px solid rgba(255,255,255,.14);
      border-radius: 20px;
      padding: 20px;
      box-sizing: border-box;
    }

    .neetos-box h2 {
      margin: 0 0 14px;
    }

    .neetos-list {
      display: grid;
      gap: 8px;
    }

    .neetos-item {
      padding: 11px;
      border-radius: 10px;
      background: rgba(255,255,255,.06);
    }

    .neetos-actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      margin-top: 16px;
    }

    .neetos-actions button {
      border: 0;
      border-radius: 10px;
      padding: 10px 14px;
      cursor: pointer;
    }

    .np {
      background: #19b7a3;
      color: #06121c;
    }

    .ns {
      background: rgba(255,255,255,.1);
      color: #fff;
    }

    .neetos-box input {
      width: 100%;
      box-sizing: border-box;
      padding: 10px;
      margin: 5px 0 12px;
      border-radius: 10px;
      background: rgba(255,255,255,.07);
      color: #fff;
      border: 1px solid rgba(255,255,255,.15);
    }

  `;

  document.head.appendChild(
    style
  );
}


function closeOverlay() {
  $("neetOSOverlay")?.remove();
}


function modalBox(
  title,
  html,
  buttons = []
) {
  closeOverlay();

  const overlay =
    document.createElement(
      "div"
    );

  overlay.id =
    "neetOSOverlay";

  overlay.className =
    "neetos-overlay";

  const box =
    document.createElement(
      "div"
    );

  box.className =
    "neetos-box";

  box.innerHTML =
    `
      <h2>${esc(title)}</h2>
      ${html}
    `;

  const actions =
    document.createElement(
      "div"
    );

  actions.className =
    "neetos-actions";

  buttons.forEach(
    buttonData => {
      const button =
        document.createElement(
          "button"
        );

      button.textContent =
        buttonData.label;

      button.className =
        buttonData.primary
          ? "np"
          : "ns";

      button.onclick =
        buttonData.onClick;

      actions.appendChild(
        button
      );
    }
  );

  const close =
    document.createElement(
      "button"
    );

  close.textContent =
    "Close";

  close.className =
    "ns";

  close.onclick =
    closeOverlay;

  actions.appendChild(
    close
  );

  box.appendChild(
    actions
  );

  overlay.appendChild(
    box
  );

  overlay.onclick =
    event => {
      if (
        event.target ===
        overlay
      ) {
        closeOverlay();
      }
    };

  document.body.appendChild(
    overlay
  );
}


/* =========================================================
   MORE FEATURES
========================================================= */

function setupMoreFeatures() {
  document
    .querySelectorAll(
      "#moreSection .feature-row"
    )
    .forEach(
      row => {
        if (
          row.dataset.neetosBound
        ) {
          return;
        }

        row.dataset.neetosBound =
          "1";

        row.classList.add(
          "neetos-click"
        );

        const text =
          row.textContent.toLowerCase();

        row.addEventListener(
          "click",
          () => {
            if (
              text.includes(
                "daily routine"
              )
            ) {
              openDailyRoutine();

            } else if (
              text.includes(
                "missed tasks"
              )
            ) {
              openMissedTasks();

            } else if (
              text.includes(
                "streak"
              )
            ) {
              openStreak();

            } else if (
              text.includes(
                "sleep tracking"
              )
            ) {
              openSleepTracking();

            } else if (
              text.includes(
                "30-day report"
              )
            ) {
              open30DayReport();

            } else if (
              text.includes(
                "personal best"
              )
            ) {
              openPersonalBest();

            } else if (
              text.includes(
                "settings"
              )
            ) {
              openSettings();

            } else if (
              text.includes(
                "backup"
              )
            ) {
              openBackup();
            }
          }
        );
      }
    );
}


/* =========================================================
   DAILY ROUTINE
========================================================= */

function openDailyRoutine() {
  const html =
    `
      <p>
        Fixed schedule. Time slots are unchanged.
      </p>

      <div class="neetos-list">

        ${tasks.map(
          (task, index) => `
            <div class="neetos-item">

              <b>
                ${index + 1}.
                ${esc(task.name)}
              </b>

              <br>

              ${esc(
                formatRange(task)
              )}

              ${
                task.target
                  ? `<br>Target: ${task.target} questions`
                  : ""
              }

            </div>
          `
        ).join("")}

      </div>
    `;

  modalBox(
    "Daily Routine",
    html
  );
}


/* =========================================================
   MISSED TASKS
========================================================= */

function openMissedTasks() {
  const now =
    getCurrentMinutes();

  const missed =
    tasks
      .map(
        (task, index) => ({
          task,
          index
        })
      )
      .filter(
        item => {
          const task =
            item.task;

          const index =
            item.index;

          if (
            data.completed[index] ||
            data.activeTask === index
          ) {
            return false;
          }

          const start =
            timeToMinutes(
              task.start
            );

          const end =
            timeToMinutes(
              task.end
            );

          /*
             Normal task
          */

          if (end > start) {
            return now >= end;
          }

          /*
             Overnight task.
             After 02:00 but before 23:00
             it is considered missed.
          */

          return (
            now >= end &&
            now < start
          );
        }
      );

  if (!missed.length) {
    modalBox(
      "Missed Tasks",
      `
        <p>
          <b>
            No missed task detected right now.
          </b>
        </p>
      `
    );

    return;
  }

  const html =
    `
      <div class="neetos-list">

        ${missed.map(
          item => `
            <div class="neetos-item">

              <b>
                ${esc(
                  item.task.name
                )}
              </b>

              <br>

              ${esc(
                formatRange(
                  item.task
                )
              )}

              <br><br>

              <button
                class="ns"
                data-repair="${item.index}"
              >
                Record reason
              </button>

            </div>
          `
        ).join("")}

      </div>
    `;

  modalBox(
    "Missed Tasks / Repair",
    html
  );

  document
    .querySelectorAll(
      "[data-repair]"
    )
    .forEach(
      button => {
        button.onclick =
          () => {
            const index =
              Number(
                button.dataset.repair
              );

            const reason =
              prompt(
                "Why was this task missed?",
                ""
              ) ||
              "Not specified";

            data.missedReasons[index] =
              reason;

            data.repairLog.push({
              date: data.date,
              taskIndex: index,
              reason,
              at: Date.now()
            });

            saveData();

            closeOverlay();

            alert(
              "Missed-task reason saved."
            );
          };
      }
    );
}


/* =========================================================
   STREAK
========================================================= */

function openStreak() {
  const records =
    getHistory();

  const current =
    createSnapshot(data);

  if (current) {
    records.push(current);
  }

  const byDate = {};

  records.forEach(
    record => {
      if (record?.date) {
        byDate[record.date] =
          record;
      }
    }
  );

  let key =
    getStudyDayKey();

  let streak = 0;

  for (
    let i = 0;
    i < 180;
    i++
  ) {
    const record =
      byDate[key];

    if (
      !record ||
      (
        !record.totalStudySeconds &&
        !record.completedCount
      )
    ) {
      break;
    }

    streak++;

    const d =
      parseDate(key);

    d.setDate(
      d.getDate() - 1
    );

    key =
      dateKey(d);
  }

  modalBox(
    "Streak",
    `
      <p>
        Current study streak:
        <b>
          ${streak}
          day${streak === 1 ? "" : "s"}
          🔥
        </b>
      </p>
    `
  );
}


/* =========================================================
   SLEEP TRACKING
========================================================= */

function openSleepTracking() {
  const sleep =
    data.sleep || {};

  const html =
    `
      <p>
        Save sleep/wake time for this study day.
      </p>

      <label>
        Sleep time

        <input
          id="sleepTime"
          type="time"
          value="${esc(
            sleep.sleepTime || ""
          )}"
        >

      </label>

      <label>
        Wake time

        <input
          id="wakeTime"
          type="time"
          value="${esc(
            sleep.wakeTime || ""
          )}"
        >

      </label>
    `;

  modalBox(
    "Sleep Tracking",
    html,
    [
      {
        label: "Save",
        primary: true,

        onClick: () => {
          data.sleep = {
            sleepTime:
              $("sleepTime")?.value ||
              "",

            wakeTime:
              $("wakeTime")?.value ||
              "",

            savedAt:
              Date.now()
          };

          saveData();

          closeOverlay();

          alert(
            "Sleep data saved."
          );
        }
      }
    ]
  );
}


/* =========================================================
   30 DAY REPORT
========================================================= */

function open30DayReport() {
  const records =
    getHistory();

  const current =
    createSnapshot(data);

  if (current) {
    records.push(current);
  }

  const byDate = {};

  records.forEach(
    record => {
      if (record?.date) {
        byDate[record.date] =
          record;
      }
    }
  );

  const days =
    Object.values(byDate)
      .sort(
        (a, b) =>
          a.date.localeCompare(
            b.date
          )
      )
      .slice(-30);

  const totalStudy =
    days.reduce(
      (sum, record) =>
        sum +
        Number(
          record.totalStudySeconds ||
            0
        ),
      0
    );

  const totalQuestions =
    days.reduce(
      (sum, record) =>
        sum +
        Number(
          record.totalQuestions ||
            0
        ),
      0
    );

  const totalTasks =
    days.reduce(
      (sum, record) =>
        sum +
        Number(
          record.completedCount ||
            0
        ),
      0
    );

  modalBox(
    "30-Day Report",
    `
      <div class="neetos-list">

        <div class="neetos-item">
          Days recorded:
          <b>
            ${days.length} / 30
          </b>
        </div>

        <div class="neetos-item">
          Total study:
          <b>
            ${shortDuration(
              totalStudy
            )}
          </b>
        </div>

        <div class="neetos-item">
          Average/day:
          <b>
            ${shortDuration(
              days.length
                ? totalStudy /
                  days.length
                : 0
            )}
          </b>
        </div>

        <div class="neetos-item">
          Tasks completed:
          <b>
            ${totalTasks}
          </b>
        </div>

        <div class="neetos-item">
          Questions solved:
          <b>
            ${totalQuestions}
          </b>
        </div>

      </div>
    `
  );
}


/* =========================================================
   PERSONAL BEST
========================================================= */

function openPersonalBest() {
  const records =
    getHistory();

  const current =
    createSnapshot(data);

  if (current) {
    records.push(current);
  }

  const bestStudy =
    records.reduce(
      (best, record) =>
        !best ||
        Number(
          record.totalStudySeconds ||
            0
        ) >
          Number(
            best.totalStudySeconds ||
              0
          )
          ? record
          : best,
      null
    );

  const bestQuestions =
    records.reduce(
      (best, record) =>
        !best ||
        Number(
          record.totalQuestions ||
            0
        ) >
          Number(
            best.totalQuestions ||
              0
          )
          ? record
          : best,
      null
    );

  const bestTasks =
    records.reduce(
      (best, record) =>
        !best ||
        Number(
          record.completedCount ||
            0
        ) >
          Number(
            best.completedCount ||
              0
          )
          ? record
          : best,
      null
    );

  modalBox(
    "Personal Best",
    `
      <div class="neetos-list">

        <div class="neetos-item">
          ⏱️ Most study:
          <b>
            ${
              bestStudy
                ? shortDuration(
                    bestStudy.totalStudySeconds
                  ) +
                  " — " +
                  bestStudy.date
                : "—"
            }
          </b>
        </div>

        <div class="neetos-item">
          📝 Most questions:
          <b>
            ${
              bestQuestions
                ? (
                    bestQuestions.totalQuestions ||
                    0
                  ) +
                  " — " +
                  bestQuestions.date
                : "—"
            }
          </b>
        </div>

        <div class="neetos-item">
          ✅ Most tasks:
          <b>
            ${
              bestTasks
                ? (
                    bestTasks.completedCount ||
                    0
                  ) +
                  " — " +
                  bestTasks.date
                : "—"
            }
          </b>
        </div>

      </div>
    `
  );
}


/* =========================================================
   SETTINGS
========================================================= */

function getSettings() {
  try {
    return JSON.parse(
      localStorage.getItem(
        SETTINGS_KEY
      ) || "{}"
    );
  } catch {
    return {};
  }
}


function saveSettings(settings) {
  localStorage.setItem(
    SETTINGS_KEY,
    JSON.stringify(settings)
  );
}


async function requestNotificationPermission() {
  if (
    !("Notification" in window)
  ) {
    alert(
      "This browser does not support notifications."
    );

    return false;
  }

  try {
    const permission =
      await Notification.requestPermission();

    const settings =
      getSettings();

    settings.notifications =
      permission ===
      "granted";

    saveSettings(
      settings
    );

    return (
      permission ===
      "granted"
    );

  } catch (error) {
    console.error(
      error
    );

    alert(
      "Chrome did not allow notification permission here. Try opening NEET OS with Live Server."
    );

    return false;
  }
}


/* =========================================================
   TEST NOTIFICATION
========================================================= */

async function sendTestNotification() {
  if (
    !("Notification" in window)
  ) {
    alert(
      "Notifications are not supported."
    );

    return;
  }

  if (
    Notification.permission !==
    "granted"
  ) {
    alert(
      "First allow notifications."
    );

    return;
  }

     try {
    if (!("Notification" in window)) {
        alert("This browser does not support notifications.");
        return;
    }

    if (Notification.permission !== "granted") {
        const permission =
            await Notification.requestPermission();

        if (permission !== "granted") {
            alert("Notification permission was not granted.");
            return;
        }
    }

    let registration =
        await navigator.serviceWorker.getRegistration();

    if (!registration) {
        registration =
            await navigator.serviceWorker.register(
                "./service-worker.js"
            );
    }

    registration =
        await navigator.serviceWorker.ready;

    await registration.showNotification(
        "NEET OS — Test Reminder",
        {
            body:
                "Notifications are working correctly.",
            icon:
                "./icons/icon-192.png",
            badge:
                "./icons/icon-192.png",
            data: {
                url: "./index.html"
            }
        }
    );

} catch (error) {

    console.error(
        "Notification test failed:",
        error
    );

    alert(
        "Notification test failed: " +
        error.message
    );
}
}


/* =========================================================
   NOTIFICATION REMINDER CALCULATION
========================================================= */

function reminderDifference(task) {
  const current =
    getCurrentMinutes();

  const start =
    timeToMinutes(
      task.start
    );

  let difference =
    start - current;

  /*
     For 00:30 / 00:00 tasks:
     If current time is late evening,
     next occurrence is tomorrow.
  */

  if (
    difference < 0 &&
    start < 180 &&
    current >= 180
  ) {
    difference += 1440;
  }

  return difference;
}


/* =========================================================
   NOTIFICATION PANEL
========================================================= */

function openNotificationPanel() {
  const settings =
    getSettings();

  const permission =
    "Notification" in window
      ? Notification.permission
      : "unsupported";

  const upcoming =
    tasks
      .map(
        (task, index) => ({
          task,
          index,
          difference:
            reminderDifference(
              task
            )
        })
      )
      .filter(
        item =>
          item.difference >= 0 &&
          item.difference <= 180
      )
      .sort(
        (a, b) =>
          a.difference -
          b.difference
      )
      .slice(0, 5);

  let upcomingHTML = "";

  if (!upcoming.length) {
    upcomingHTML =
      `
        <div class="neetos-item">
          No scheduled task in the next 3 hours.
        </div>
      `;

  } else {
    upcomingHTML =
      upcoming
        .map(
          item =>
            `
              <div class="neetos-item">

                <b>
                  ${esc(
                    item.task.name
                  )}
                </b>

                <br>

                ${esc(
                  formatRange(
                    item.task
                  )
                )}

                •
                ${
                  item.difference === 0
                    ? "Starting now"
                    : `Starts in ${item.difference} min`
                }

              </div>
            `
        )
        .join("");
  }

  let status = "";

  if (
    permission ===
    "granted"
  ) {
    status =
      settings.notifications
        ? "Reminders are ON."
        : "Permission granted, but reminders are OFF.";

  } else if (
    permission ===
    "denied"
  ) {
    status =
      "Chrome notification permission is blocked.";

  } else if (
    permission ===
    "unsupported"
  ) {
    status =
      "Browser notifications are not supported.";

  } else {
    status =
      "Notification permission is not granted yet.";
  }

  const buttons = [];

  /*
     Allow permission button
  */

  if (
    permission ===
    "default"
  ) {
    buttons.push({
      label:
        "Allow Notifications",

      primary:
        true,

      onClick:
        async () => {
          await requestNotificationPermission();

          closeOverlay();

          openNotificationPanel();
        }
    });
  }

  /*
     ON / OFF
  */

  buttons.push({
    label:
      settings.notifications
        ? "Turn Reminders OFF"
        : "Turn Reminders ON",

    primary:
      true,

    onClick:
      () => {
        const current =
          getSettings();

        current.notifications =
          !current.notifications;

        saveSettings(
          current
        );

        closeOverlay();

        openNotificationPanel();
      }
  });

  /*
     Test
  */

  buttons.push({
    label:
      "Test Notification",

    onClick:
      sendTestNotification
  });

  modalBox(
    "Notifications & Reminders",

    `
      <div class="neetos-item">

        <b>
          Status:
        </b>

        <br>

        ${esc(status)}

        <br>

        <small>
          Chrome permission:
          ${esc(permission)}
        </small>

      </div>

      <h3>
        Upcoming Tasks
      </h3>

      <div class="neetos-list">
        ${upcomingHTML}
      </div>
    `,

    buttons
  );
}


/* =========================================================
   AUTOMATIC NOTIFICATIONS
========================================================= */

function maybeNotifySchedule() {
  const settings =
    getSettings();

  if (
    !settings.notifications
  ) {
    return;
  }

  if (
    !("Notification" in window)
  ) {
    return;
  }

  if (
    Notification.permission !==
    "granted"
  ) {
    return;
  }

  tasks.forEach(
    (task, index) => {
      /*
         Don't notify completed task.
      */

      if (
        data.completed[index]
      ) {
        return;
      }

      const difference =
        reminderDifference(
          task
        );

      /*
         Reminder window:
         10 minutes before
         until task starts.

         This is intentionally
         NOT an exact-minute check.
      */

      if (
        difference >= 0 &&
        difference <= 10
      ) {
        const key =
          `neetOSNotify:${getStudyDayKey()}:${index}`;

        if (
          localStorage.getItem(
            key
          )
        ) {
          return;
        }

        localStorage.setItem(
          key,
          String(Date.now())
        );

        try {
    if ("serviceWorker" in navigator) {

        navigator.serviceWorker.ready.then((registration) => {

            registration.showNotification(
                "NEET OS — Upcoming Task",
                {
                    body:
                        `${task.name} starts in ${difference} minute${difference === 1 ? "" : "s"}.`,
                    icon: "./icons/icon-192.png",
                    badge: "./icons/icon-192.png",
                    data: {
                        url: "./index.html"
                    }
                }
            );

        });

    }
} catch (error) {
    console.error(
        "Notification error:",
        error
    );
}
      }
    }
  );
}


/* =========================================================
   SETTINGS PAGE
========================================================= */

function openSettings() {
  const settings =
    getSettings();

  modalBox(
    "Settings",

    `
      <p>
        Browser reminders use Chrome notification permission.
      </p>

      <label>

        <input
          id="notificationCheckbox"
          type="checkbox"
          ${
            settings.notifications
              ? "checked"
              : ""
          }
        >

        Enable reminders

      </label>
    `,

    [
      {
        label:
          "Save",

        primary:
          true,

        onClick:
          async () => {
            const current =
              getSettings();

            current.notifications =
              !!$(
                "notificationCheckbox"
              )?.checked;

            saveSettings(
              current
            );

            if (
              current.notifications &&
              "Notification" in window &&
              Notification.permission ===
                "default"
            ) {
              await requestNotificationPermission();
            }

            closeOverlay();

            alert(
              current.notifications
                ? "Notifications enabled."
                : "Notifications disabled."
            );
          }
      }
    ]
  );
}


/* =========================================================
   BACKUP
========================================================= */

function openBackup() {
  modalBox(
    "Backup",

    `
      <p>
        Export/import your complete local NEET OS data.
      </p>
    `,

    [
      {
        label:
          "Export Backup",

        primary:
          true,

        onClick:
          exportBackup
      },

      {
        label:
          "Import Backup",

        onClick:
          importBackup
      }
    ]
  );
}


function exportBackup() {
  const backup = {
    app:
      "NEET OS",

    version:
      VERSION,

    exportedAt:
      new Date().toISOString(),

    current:
      data,

    history:
      getHistory(),

    syllabus:
      getSyllabusState(),

    settings:
      getSettings()
  };

  const blob =
    new Blob(
      [
        JSON.stringify(
          backup,
          null,
          2
        )
      ],
      {
        type:
          "application/json"
      }
    );

  const url =
    URL.createObjectURL(
      blob
    );

  const link =
    document.createElement(
      "a"
    );

  link.href =
    url;

  link.download =
    `NEET-OS-backup-${getStudyDayKey()}.json`;

  link.click();

  setTimeout(
    () =>
      URL.revokeObjectURL(
        url
      ),
    1000
  );
}


function importBackup() {
  const input =
    document.createElement(
      "input"
    );

  input.type =
    "file";

  input.accept =
    "application/json";

  input.onchange =
    () => {
      const file =
        input.files?.[0];

      if (!file) {
        return;
      }

      const reader =
        new FileReader();

      reader.onload =
        () => {
          try {
            const backup =
              JSON.parse(
                reader.result
              );

            if (
              backup.current
            ) {
              localStorage.setItem(
                STORAGE_KEY,
                JSON.stringify(
                  backup.current
                )
              );
            }

            if (
              Array.isArray(
                backup.history
              )
            ) {
              localStorage.setItem(
                HISTORY_KEY,
                JSON.stringify(
                  backup.history
                )
              );
            }

            if (
              backup.syllabus
            ) {
              localStorage.setItem(
                SYLLABUS_KEY,
                JSON.stringify(
                  backup.syllabus
                )
              );
            }

            if (
              backup.settings
            ) {
              localStorage.setItem(
                SETTINGS_KEY,
                JSON.stringify(
                  backup.settings
                )
              );
            }

            alert(
              "Backup imported. Reloading..."
            );

            location.reload();

          } catch {
            alert(
              "Invalid NEET OS backup file."
            );
          }
        };

      reader.readAsText(
        file
      );
    };

  input.click();
}


/* =========================================================
   HEADER BUTTONS
========================================================= */

function setupHeaderButtons() {

  /*
     ☰ MENU

     Directly opens MORE.
  */

  const menu =
    $("menuButton");

  if (
    menu &&
    !menu.dataset.neetosBound
  ) {
    menu.dataset.neetosBound =
      "1";

    menu.addEventListener(
      "click",
      event => {
        event.preventDefault();
        event.stopPropagation();

        showSection(
          "more"
        );
      }
    );
  }


  /*
     🔔 NOTIFICATION

     Opens notification panel.
  */

  const notification =
    $("notificationButton");

  if (
    notification &&
    !notification.dataset.neetosBound
  ) {
    notification.dataset.neetosBound =
      "1";

    notification.addEventListener(
      "click",
      event => {
        event.preventDefault();
        event.stopPropagation();

        openNotificationPanel();
      }
    );
  }
}


/* =========================================================
   CREATOR CREDIT
========================================================= */

function addCreatorCredit() {
  const more =
    $("moreSection");

  if (
    !more ||
    $("creatorCredit")
  ) {
    return;
  }

  const credit =
    document.createElement(
      "div"
    );

  credit.id =
    "creatorCredit";

  credit.className =
    "simple-card";

  credit.innerHTML =
    `
      <p
        style="
          text-align:center;
          opacity:.7;
          margin:0;
        "
      >
        The app is created by
        <strong>Dibyendu</strong>
      </p>
    `;

  more.appendChild(
    credit
  );
}


/* =========================================================
   TEST API
========================================================= */

window.NEETOS = {

  /*
     Start any task immediately.
     Used only for testing.
  */

  startNow: index =>
    startTask(
      Number(index),
      true
    ),

  /*
     Same test helper.
  */

  testStart: (
    index = 3
  ) =>
    startTask(
      Number(index),
      true
    ),

  /*
     Stop current task.
  */

  stop: () => {
    if (
      data?.activeTask !==
      null
    ) {
      stopTask(
        data.activeTask
      );
    }
  },

  /*
     Reset today's progress.
  */

  resetToday: () => {
    if (
      confirm(
        "Reset ALL today's NEET OS progress?"
      )
    ) {
      data =
        createFreshData();

      saveData();

      renderTasks();

      updateProgress();

      updateStats();
    }
  },

  tasks,

  data: () =>
    data
};


/* =========================================================
   INITIALIZATION
========================================================= */

function initializeNEETOS() {
  if (initialized) {
    return;
  }

  initialized =
    true;

  addCustomStyle();

  data =
    loadData();

  activeStudyDayKey =
    getStudyDayKey();

  updateDateHeader();

  ensureScheduleCards();

  setupTaskButtons();

  setupModal();

  setupNavigation();

  setupHeaderButtons();

  setupMoreFeatures();

  renderSyllabus();

  renderTasks();

  updateProgress();

  updateStats();

  addCreatorCredit();

  /*
     Always start on Home.
  */

  showSection(
    "home"
  );
}


/*
   DOM ready
*/

if (
  document.readyState ===
  "loading"
) {
  document.addEventListener(
    "DOMContentLoaded",
    initializeNEETOS
  );
} else {
  initializeNEETOS();
}


/* =========================================================
   LIVE APP LOOP
========================================================= */

setInterval(
  () => {
    if (!data) {
      return;
    }

    /*
       03:00 rollover check
    */

    checkDailyRollover();

    /*
       Midnight date/week/day update
    */

    updateDateHeader();

    /*
       Task button state
    */

    renderTasks();

    /*
       Progress
    */

    updateProgress();

    /*
       Stats
    */

    updateStats();

    /*
       Notifications
    */

    maybeNotifySchedule();

  },
  1000
);


/* =========================================================
   SAVE ACTIVE SESSION BEFORE REFRESH/CLOSE
========================================================= */

window.addEventListener(
  "beforeunload",
  () => {

    if (
      data?.activeTask !==
        null &&
      data?.activeStartTime
    ) {

      const index =
        data.activeTask;

      const elapsed =
        Math.max(
          0,
          Math.floor(
            (Date.now() -
              data.activeStartTime) /
              1000
          )
        );

      data.studySeconds[index] =
        Number(
          data.studySeconds[index] ||
            0
        ) + elapsed;

      /*
         Keep activeStartTime alive
         so the timer doesn't lose
         the current session after
         a refresh.
      */

      data.activeStartTime =
        Date.now();

      saveData();
    }
  }
);/* =========================================================
   NEET OS — ROBUST DATA STORAGE UPGRADE
   IndexedDB + localStorage compatibility mirror
   ========================================================= */

(function NEETOSStorageUpgrade() {

    const DB_NAME = "NEET_OS_DB";
    const DB_VERSION = 1;
    const STORE_NAME = "data";

    const IMPORTANT_KEYS = new Set([
        "neetOSStudyData",
        "neetOSHistory",
        "neetOSSyllabus",
        "neetOSSettings"
    ]);

    let db = null;

    /* ---------- Open database ---------- */

    function openDatabase() {
        return new Promise((resolve, reject) => {

            if (!("indexedDB" in window)) {
                reject(new Error("IndexedDB not supported"));
                return;
            }

            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onupgradeneeded = function () {
                const database = request.result;

                if (!database.objectStoreNames.contains(STORE_NAME)) {
                    database.createObjectStore(STORE_NAME);
                }
            };

            request.onsuccess = function () {
                db = request.result;
                resolve(db);
            };

            request.onerror = function () {
                reject(request.error);
            };
        });
    }

    /* ---------- Write to IndexedDB ---------- */

    function dbWrite(key, value) {

        if (!db || !IMPORTANT_KEYS.has(key)) {
            return Promise.resolve();
        }

        return new Promise(resolve => {

            try {

                const tx = db.transaction(STORE_NAME, "readwrite");
                const store = tx.objectStore(STORE_NAME);

                store.put({
                    key: key,
                    value: value,
                    savedAt: Date.now()
                }, key);

                tx.oncomplete = () => resolve();
                tx.onerror = () => resolve();

            } catch (e) {
                resolve();
            }

        });
    }

    /* ---------- Read from IndexedDB ---------- */

    function dbRead(key) {

        if (!db || !IMPORTANT_KEYS.has(key)) {
            return Promise.resolve(null);
        }

        return new Promise(resolve => {

            try {

                const tx = db.transaction(STORE_NAME, "readonly");
                const store = tx.objectStore(STORE_NAME);
                const request = store.get(key);

                request.onsuccess = function () {
                    resolve(request.result || null);
                };

                request.onerror = function () {
                    resolve(null);
                };

            } catch (e) {
                resolve(null);
            }

        });
    }

    /* ---------- Backup all important localStorage data ---------- */

    async function migrateExistingData() {

        for (const key of IMPORTANT_KEYS) {

            try {

                const localValue = localStorage.getItem(key);

                if (localValue !== null) {

                    const existing = await dbRead(key);

                    /*
                     * localStorage is considered the current source
                     * during the first migration.
                     */
                    if (!existing) {
                        await dbWrite(key, localValue);
                    }
                }

            } catch (e) {
                console.warn("NEET OS migration warning:", key, e);
            }
        }
    }

    /* ---------- Restore missing localStorage data ---------- */

    async function restoreMissingData() {

        for (const key of IMPORTANT_KEYS) {

            try {

                const localValue = localStorage.getItem(key);

                if (localValue === null) {

                    const record = await dbRead(key);

                    if (record && record.value !== undefined) {

                        localStorage.setItem(
                            key,
                            record.value
                        );

                        console.log(
                            "NEET OS restored:",
                            key
                        );
                    }
                }

            } catch (e) {
                console.warn("NEET OS restore warning:", key, e);
            }
        }
    }

    /* ---------- Mirror future localStorage writes ---------- */

    const originalSetItem = Storage.prototype.setItem;

    Storage.prototype.setItem = function (key, value) {

        originalSetItem.call(this, key, value);

        if (
            this === window.localStorage &&
            IMPORTANT_KEYS.has(String(key))
        ) {
            dbWrite(String(key), String(value))
                .catch(() => {});
        }
    };

    /* ---------- Persistent storage request ---------- */

    async function requestPersistentStorage() {

        try {

            if (
                navigator.storage &&
                navigator.storage.persist
            ) {

                const persistent =
                    await navigator.storage.persist();

                console.log(
                    "NEET OS persistent storage:",
                    persistent ? "enabled" : "not granted"
                );
            }

        } catch (e) {
            console.warn(
                "NEET OS persistent storage unavailable:",
                e
            );
        }
    }

    /* ---------- Status ---------- */

    window.NEETOSStorage = {

        status: function () {
            return {
                database: DB_NAME,
                indexedDB: !!db,
                localStorage: true
            };
        },

        save: async function (key) {

            if (!IMPORTANT_KEYS.has(key)) return false;

            const value = localStorage.getItem(key);

            if (value === null) return false;

            await dbWrite(key, value);

            return true;
        },

        restore: restoreMissingData
    };

    /* ---------- Start ---------- */

    async function initializeStorage() {

        try {

            await openDatabase();

            /*
             * First try to restore missing data.
             * If localStorage already contains data,
             * it remains untouched.
             */
            await restoreMissingData();

            /*
             * Then make sure all existing data is mirrored
             * into IndexedDB.
             */
            await migrateExistingData();

            await requestPersistentStorage();

            console.log(
                "NEET OS: Robust storage system ready."
            );

        } catch (e) {

            console.warn(
                "NEET OS: IndexedDB unavailable. " +
                "Continuing with localStorage.",
                e
            );
        }
    }

    initializeStorage();

})();
