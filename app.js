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
    name: "Biology Revision + NCERT + Questions",
    start: "21:00",
    end: "22:30",
    type: "biology",
    subject: "Biology",
    target: 50
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
  },
  {
    name: "Self Study",
    start: "00:00",
    end: "23:59",
    type: "self-study",
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
  if (task.type === "self-study") {
    return true;
  }

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


function isProgressTask(index) {
  return tasks[index]?.type !== "self-study";
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
        (isProgressTask(index) &&
        currentData.completed?.[index]
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
    task.type !== "self-study" &&
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
    task.type === "biology" ||
    task.type === "self-study"
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
  const progressTasks = tasks.filter(
    (_, index) => isProgressTask(index)
  );

  const completed = progressTasks.reduce(
    (sum, task) => {
      const index = tasks.indexOf(task);
      return sum + (data.completed[index] ? 1 : 0);
    },
    0
  );

  const totalTasks = progressTasks.length;

  const percentage =
    totalTasks > 0
      ? Math.round((completed / totalTasks) * 100)
      : 0;

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
      `${completed} / ${totalTasks}`;
  }

  if ($("taskProgressBar")) {
    $("taskProgressBar").style.width =
      percentage + "%";
  }

  if ($("studyProgress")) {
    $("studyProgress").style.width =
      Math.min(
        100,
        Math.round(
          (studySeconds / (12 * 3600)) * 100
        )
      ) + "%";
  }

  if ($("studyTime")) {
    $("studyTime").textContent =
      shortDuration(studySeconds);
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
    tasks.reduce(
      (sum, _, index) =>
        sum +
        (isProgressTask(index) && data.completed[index]
          ? 1
          : 0),
      0
    );

  const totalTasks =
    tasks.filter((_, index) => isProgressTask(index)).length;

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
      `${completed} / ${totalTasks}`;
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
            !isProgressTask(index) ||
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
      "Chrome did not allow notification permission here. Please allow notifications for NEET OS."
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
  if (task.type === "self-study") {
    return Infinity;
  }

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
          item.task.type !== "self-study" &&
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

async function maybeNotifySchedule() {
  const settings = getSettings();

  if (!settings.notifications) {
    return;
  }

  if (
    !("Notification" in window) ||
    Notification.permission !== "granted"
  ) {
    return;
  }

  if (!("serviceWorker" in navigator)) {
    return;
  }

  let registration;

  try {
    registration = await navigator.serviceWorker.ready;
  } catch (error) {
    console.error("Service worker is not ready:", error);
    return;
  }

  for (const [index, task] of tasks.entries()) {
    if (
      task.type === "self-study" ||
      data.completed[index]
    ) {
      continue;
    }

    const difference = reminderDifference(task);

    if (difference < 0 || difference > 10) {
      continue;
    }

    const key =
      `neetOSNotify:${getStudyDayKey()}:${index}`;

    if (localStorage.getItem(key)) {
      continue;
    }

    localStorage.setItem(key, String(Date.now()));

    try {
      await registration.showNotification(
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
    } catch (error) {
      localStorage.removeItem(key);
      console.error("Notification error:", error);
    }
  }
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

    void maybeNotifySchedule();

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
   END OF DAY / HISTORY UTILITIES
========================================================= */

function getRecordForDate(key) {
  if (!key) {
    return null;
  }

  if (
    data &&
    data.date === key
  ) {
    return createSnapshot(data);
  }

  const history =
    getHistory();

  return (
    history.find(
      record =>
        record &&
        record.date === key
    ) || null
  );
}


function getLastNDates(count = 30) {
  const result = [];

  let d =
    new Date();

  for (
    let i = 0;
    i < count;
    i++
  ) {
    result.push(
      dateKey(d)
    );

    d.setDate(
      d.getDate() - 1
    );
  }

  return result;
}


function calculateDayScore(record) {
  if (!record) {
    return 0;
  }

  const completed =
    Number(
      record.completedCount || 0
    );

  const questions =
    Number(
      record.totalQuestions || 0
    );

  const studySeconds =
    Number(
      record.totalStudySeconds || 0
    );

  /*
     Score is a simple internal
     consistency indicator.
  */

  const taskScore =
    Math.min(
      100,
      (completed / 8) * 100
    );

  const questionScore =
    Math.min(
      100,
      (questions / 180) * 100
    );

  const studyScore =
    Math.min(
      100,
      (studySeconds / (10 * 3600)) *
        100
    );

  return Math.round(
    taskScore * 0.4 +
    questionScore * 0.3 +
    studyScore * 0.3
  );
}


/* =========================================================
   WEEK CALCULATION
========================================================= */

function getWeekInfo(key = calendarDayKey()) {
  const day =
    dayNumber(key);

  return {
    day,
    week:
      Math.ceil(day / 7),
    dayInWeek:
      ((day - 1) % 7) + 1
  };
}


function getWeekLabel(key = calendarDayKey()) {
  const info =
    getWeekInfo(key);

  return (
    `Week ${info.week} • Day ${info.day}`
  );
}


/* =========================================================
   HOME HEADER UPDATE
========================================================= */

function updateHomeHeader() {
  const key =
    calendarDayKey();

  const info =
    getWeekInfo(key);

  /*
     Possible existing elements.
     We update whichever ones
     exist in the current HTML.
  */

  const selectors = [
    "#weekText",
    "#weekNumber",
    ".week-number",
    ".week-label"
  ];

  selectors.forEach(
    selector => {
      document
        .querySelectorAll(selector)
        .forEach(
          element => {
            element.textContent =
              `Week ${info.week}`;
          }
        );
    }
  );

  document
    .querySelectorAll(
      "#dayText, #dayNumber, .day-number, .day-label"
    )
    .forEach(
      element => {
        element.textContent =
          `Day ${info.day}`;
      }
    );
}


/* =========================================================
   DAILY PROGRESS DETAILS
========================================================= */

function getCompletedTaskCount() {
  if (!data) {
    return 0;
  }

  return tasks.reduce(
    (count, _, index) =>
      count +
      (
        isProgressTask(index) &&
        data.completed[index]
          ? 1
          : 0
      ),
    0
  );
}


function getIncompleteTaskCount() {
  return Math.max(
    0,
    8 -
      getCompletedTaskCount()
  );
}


function getTaskQuestionCount(index) {
  return Number(
    data?.questionCounts?.[index] ||
      0
  );
}


function getSubjectStudySeconds(subject) {
  return tasks.reduce(
    (total, task, index) => {
      if (
        task.subject !== subject
      ) {
        return total;
      }

      return (
        total +
        getTaskStudySeconds(
          index
        )
      );
    },
    0
  );
}


/* =========================================================
   HOME DASHBOARD
========================================================= */

function updateHomeDashboard() {
  const completed =
    getCompletedTaskCount();

  const total =
    tasks.filter(
      (_, index) =>
        isProgressTask(index)
    ).length;

  const percentage =
    total
      ? Math.round(
          (completed / total) *
            100
        )
      : 0;

  const studySeconds =
    getTotalStudySeconds();

  const questions =
    getTotalQuestions();

  /*
     Main progress percentage.
  */

  document
    .querySelectorAll(
      "[data-progress-percent]"
    )
    .forEach(
      element => {
        element.textContent =
          percentage + "%";
      }
    );

  /*
     Completed / total.
  */

  document
    .querySelectorAll(
      "[data-task-count]"
    )
    .forEach(
      element => {
        element.textContent =
          `${completed} / ${total}`;
      }
    );

  /*
     Study time.
  */

  document
    .querySelectorAll(
      "[data-study-time]"
    )
    .forEach(
      element => {
        element.textContent =
          shortDuration(
            studySeconds
          );
      }
    );

  /*
     Questions.
  */

  document
    .querySelectorAll(
      "[data-question-count]"
    )
    .forEach(
      element => {
        element.textContent =
          questions;
      }
    );

  /*
     Progress bars.
  */

  document
    .querySelectorAll(
      "[data-progress-bar]"
    )
    .forEach(
      element => {
        element.style.width =
          percentage + "%";
      }
    );

  /*
     Subject-wise time.
  */

  document
    .querySelectorAll(
      "[data-subject]"
    )
    .forEach(
      element => {
        const subject =
          element.dataset.subject;

        element.textContent =
          shortDuration(
            getSubjectStudySeconds(
              subject
            )
          );
      }
    );

  /*
     Current active task.
  */

  document
    .querySelectorAll(
      "[data-active-task]"
    )
    .forEach(
      element => {
        if (
          data.activeTask ===
          null
        ) {
          element.textContent =
            "No active session";
        } else {
          element.textContent =
            tasks[
              data.activeTask
            ]?.name ||
            "Study session";
        }
      }
    );
}


/* =========================================================
   ACTIVE TIMER DISPLAY
========================================================= */

function updateActiveTimer() {
  if (
    !data ||
    data.activeTask ===
      null
  ) {
    return;
  }

  const index =
    data.activeTask;

  const seconds =
    getTaskStudySeconds(
      index
    );

  const formatted =
    formatTimer(
      seconds
    );

  const timer =
    document.querySelector(
      `#timer-${index}`
    );

  if (timer) {
    timer.textContent =
      formatted;
  }

  document
    .querySelectorAll(
      "[data-live-timer]"
    )
    .forEach(
      element => {
        element.textContent =
          formatted;
      }
    );
}


/* =========================================================
   TASK STATUS TEXT
========================================================= */

function taskStatusText(index) {
  const task =
    tasks[index];

  if (!task) {
    return "";
  }

  if (
    data.activeTask ===
    index
  ) {
    return "Running now";
  }

  if (
    data.completed[index]
  ) {
    return "Completed";
  }

  if (
    task.type ===
    "self-study"
  ) {
    return "Available anytime";
  }

  if (
    isTaskInWindow(task)
  ) {
    return "Available now";
  }

  return `Scheduled: ${formatRange(task)}`;
}


function updateTaskStatusLabels() {
  document
    .querySelectorAll(
      "[data-task-status]"
    )
    .forEach(
      element => {
        const index =
          Number(
            element.dataset.taskStatus
          );

        element.textContent =
          taskStatusText(
            index
          );
      }
    );
}


/* =========================================================
   DAILY SUMMARY
========================================================= */

function buildDailySummary() {
  const completed =
    getCompletedTaskCount();

  const questions =
    getTotalQuestions();

  const studySeconds =
    getTotalStudySeconds();

  const score =
    calculateDayScore(
      createSnapshot(data)
    );

  return {
    date:
      data?.date ||
      getStudyDayKey(),

    completed,

    totalTasks:
      8,

    questions,

    studySeconds,

    score
  };
}


function openDailySummary() {
  const summary =
    buildDailySummary();

  modalBox(
    "Today's Summary",

    `
      <div class="neetos-list">

        <div class="neetos-item">
          📅 Study day:
          <b>
            ${esc(summary.date)}
          </b>
        </div>

        <div class="neetos-item">
          ✅ Tasks:
          <b>
            ${summary.completed}
            / ${summary.totalTasks}
          </b>
        </div>

        <div class="neetos-item">
          ⏱️ Study time:
          <b>
            ${shortDuration(
              summary.studySeconds
            )}
          </b>
        </div>

        <div class="neetos-item">
          📝 Questions:
          <b>
            ${summary.questions}
          </b>
        </div>

        <div class="neetos-item">
          📊 Daily score:
          <b>
            ${summary.score}%
          </b>
        </div>

      </div>
    `
  );
}


/* =========================================================
   SUNDAY TEST
========================================================= */

function getSundayTestData() {
  return (
    data?.sundayTest || {
      attempted: false,
      total: 0,
      correct: 0,
      incorrect: 0,
      skipped: 0,
      marks: 0,
      notes: ""
    }
  );
}


function saveSundayTest(test) {
  data.sundayTest = {
    ...getSundayTestData(),
    ...test,
    updatedAt:
      Date.now()
  };

  saveData();

  updateStats();
}


function openSundayTest() {
  const test =
    getSundayTestData();

  const html =
    `
      <div class="neetos-list">

        <label>
          Total Questions

          <input
            id="sundayTotal"
            type="number"
            min="0"
            value="${Number(
              test.total || 0
            )}"
          >

        </label>

        <label>
          Correct

          <input
            id="sundayCorrect"
            type="number"
            min="0"
            value="${Number(
              test.correct || 0
            )}"
          >

        </label>

        <label>
          Incorrect

          <input
            id="sundayIncorrect"
            type="number"
            min="0"
            value="${Number(
              test.incorrect || 0
            )}"
          >

        </label>

        <label>
          Skipped

          <input
            id="sundaySkipped"
            type="number"
            min="0"
            value="${Number(
              test.skipped || 0
            )}"
          >

        </label>

        <label>
          Marks

          <input
            id="sundayMarks"
            type="number"
            value="${Number(
              test.marks || 0
            )}"
          >

        </label>

        <label>
          Analysis / Notes

          <input
            id="sundayNotes"
            type="text"
            value="${esc(
              test.notes || ""
            )}"
          >

        </label>

      </div>
    `;

  modalBox(
    "Sunday Test Analysis",
    html,
    [
      {
        label:
          "Save Test",

        primary:
          true,

        onClick:
          () => {
            const total =
              Math.max(
                0,
                Number(
                  $("sundayTotal")
                    ?.value || 0
                )
              );

            const correct =
              Math.max(
                0,
                Number(
                  $("sundayCorrect")
                    ?.value || 0
                )
              );

            const incorrect =
              Math.max(
                0,
                Number(
                  $("sundayIncorrect")
                    ?.value || 0
                )
              );

            const skipped =
              Math.max(
                0,
                Number(
                  $("sundaySkipped")
                    ?.value || 0
                )
              );

            const marks =
              Number(
                $("sundayMarks")
                  ?.value || 0
              );

            const notes =
              $("sundayNotes")
                ?.value || "";

            saveSundayTest({
              attempted:
                total > 0,

              total,

              correct,

              incorrect,

              skipped,

              marks,

              notes
            });

            closeOverlay();

            alert(
              "Sunday test analysis saved."
            );
          }
      }
    ]
  );
}


/* =========================================================
   SUBJECT PERFORMANCE
========================================================= */

function getSubjectQuestions(subject) {
  return tasks.reduce(
    (sum, task, index) => {
      if (
        task.subject !==
        subject
      ) {
        return sum;
      }

      return (
        sum +
        getTaskQuestionCount(
          index
        )
      );
    },
    0
  );
}


function getSubjectTaskCount(subject) {
  return tasks.reduce(
    (sum, task, index) => {
      if (
        task.subject !==
        subject
      ) {
        return sum;
      }

      return (
        sum +
        (
          isProgressTask(index) &&
          data.completed[index]
            ? 1
            : 0
        )
      );
    },
    0
  );
}


function openSubjectStats(subject) {
  const seconds =
    getSubjectStudySeconds(
      subject
    );

  const questions =
    getSubjectQuestions(
      subject
    );

  const completed =
    getSubjectTaskCount(
      subject
    );

  modalBox(
    `${subject} Statistics`,

    `
      <div class="neetos-list">

        <div class="neetos-item">
          Study time:
          <b>
            ${shortDuration(
              seconds
            )}
          </b>
        </div>

        <div class="neetos-item">
          Questions:
          <b>
            ${questions}
          </b>
        </div>

        <div class="neetos-item">
          Completed sessions:
          <b>
            ${completed}
          </b>
        </div>

      </div>
    `
  );
}


/* =========================================================
   SUBJECT BUTTONS
========================================================= */

function setupSubjectStatsButtons() {
  document
    .querySelectorAll(
      "[data-open-subject]"
    )
    .forEach(
      button => {
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

            openSubjectStats(
              button.dataset.openSubject
            );
          }
        );
      }
    );
}


/* =========================================================
   SLEEP DURATION
========================================================= */

function minutesFromTime(time) {
  if (!time) {
    return null;
  }

  const [h, m] =
    time
      .split(":")
      .map(Number);

  if (
    Number.isNaN(h) ||
    Number.isNaN(m)
  ) {
    return null;
  }

  return h * 60 + m;
}


function calculateSleepDuration(
  sleepTime,
  wakeTime
) {
  const sleep =
    minutesFromTime(
      sleepTime
    );

  const wake =
    minutesFromTime(
      wakeTime
    );

  if (
    sleep === null ||
    wake === null
  ) {
    return null;
  }

  let duration =
    wake - sleep;

  if (
    duration <= 0
  ) {
    duration += 1440;
  }

  return duration;
}


function formatSleepDuration(minutes) {
  if (
    minutes === null ||
    minutes === undefined
  ) {
    return "—";
  }

  const h =
    Math.floor(
      minutes / 60
    );

  const m =
    minutes % 60;

  return (
    `${h}h ${String(m).padStart(2, "0")}m`
  );
}


/* =========================================================
   SLEEP SUMMARY
========================================================= */

function getSleepSummary() {
  const sleep =
    data?.sleep;

  if (!sleep) {
    return null;
  }

  const duration =
    calculateSleepDuration(
      sleep.sleepTime,
      sleep.wakeTime
    );

  return {
    ...sleep,
    duration
  };
}


/* =========================================================
   HISTORY ANALYTICS
========================================================= */

function getHistoryWithCurrent() {
  const history =
    getHistory();

  const current =
    createSnapshot(data);

  if (!current) {
    return history;
  }

  const index =
    history.findIndex(
      record =>
        record.date ===
        current.date
    );

  if (index >= 0) {
    history[index] =
      current;
  } else {
    history.push(
      current
    );
  }

  return history.sort(
    (a, b) =>
      String(a.date)
        .localeCompare(
          String(b.date)
        )
  );
}


function getAverageStudySeconds(
  days = 7
) {
  const records =
    getHistoryWithCurrent()
      .slice(-days);

  if (!records.length) {
    return 0;
  }

  const total =
    records.reduce(
      (sum, record) =>
        sum +
        Number(
          record.totalStudySeconds ||
            0
        ),
      0
    );

  return total /
    records.length;
}


function getAverageQuestions(
  days = 7
) {
  const records =
    getHistoryWithCurrent()
      .slice(-days);

  if (!records.length) {
    return 0;
  }

  const total =
    records.reduce(
      (sum, record) =>
        sum +
        Number(
          record.totalQuestions ||
            0
        ),
      0
    );

  return total /
    records.length;
}


function getBestStudySeconds() {
  return getHistoryWithCurrent()
    .reduce(
      (best, record) =>
        Math.max(
          best,
          Number(
            record.totalStudySeconds ||
              0
          )
        ),
      0
    );
}


function getBestQuestionCount() {
  return getHistoryWithCurrent()
    .reduce(
      (best, record) =>
        Math.max(
          best,
          Number(
            record.totalQuestions ||
              0
          )
        ),
      0
    );
}


/* =========================================================
   ANALYTICS REPORT
========================================================= */

function openAnalytics() {
  const records =
    getHistoryWithCurrent();

  const recent =
    records.slice(-7);

  const averageStudy =
    getAverageStudySeconds(
      7
    );

  const averageQuestions =
    getAverageQuestions(
      7
    );

  const bestStudy =
    getBestStudySeconds();

  const bestQuestions =
    getBestQuestionCount();

  const averageScore =
    recent.length
      ? recent.reduce(
          (sum, record) =>
            sum +
            calculateDayScore(
              record
            ),
          0
        ) /
        recent.length
      : 0;

  modalBox(
    "Analytics",

    `
      <div class="neetos-list">

        <div class="neetos-item">
          📈 7-day average study:
          <b>
            ${shortDuration(
              averageStudy
            )}
          </b>
        </div>

        <div class="neetos-item">
          📝 7-day average questions:
          <b>
            ${Math.round(
              averageQuestions
            )}
          </b>
        </div>

        <div class="neetos-item">
          📊 7-day average score:
          <b>
            ${Math.round(
              averageScore
            )}%
          </b>
        </div>

        <div class="neetos-item">
          🏆 Best study day:
          <b>
            ${shortDuration(
              bestStudy
            )}
          </b>
        </div>

        <div class="neetos-item">
          🏆 Best questions:
          <b>
            ${bestQuestions}
          </b>
        </div>

      </div>
    `
  );
}


/* =========================================================
   MORE MENU EXTENSION
========================================================= */

function setupMoreExtraFeatures() {
  const candidates =
    document.querySelectorAll(
      "#moreSection .feature-row, #moreSection button"
    );

  candidates.forEach(
    element => {
      if (
        element.dataset.neetosExtra
      ) {
        return;
      }

      const text =
        (
          element.textContent ||
          ""
        ).toLowerCase();

      if (
        text.includes(
          "summary"
        )
      ) {
        element.dataset.neetosExtra =
          "1";

        element.addEventListener(
          "click",
          () =>
            openDailySummary()
        );
      }

      if (
        text.includes(
          "sunday test"
        )
      ) {
        element.dataset.neetosExtra =
          "1";

        element.addEventListener(
          "click",
          () =>
            openSundayTest()
        );
      }

      if (
        text.includes(
          "analytics"
        ) ||
        text.includes(
          "statistics"
        )
      ) {
        element.dataset.neetosExtra =
          "1";

        element.addEventListener(
          "click",
          () =>
            openAnalytics()
        );
      }

      if (
        text.includes(
          "physics stats"
        )
      ) {
        element.dataset.neetosExtra =
          "1";

        element.addEventListener(
          "click",
          () =>
            openSubjectStats(
              "Physics"
            )
        );
      }

      if (
        text.includes(
          "chemistry stats"
        )
      ) {
        element.dataset.neetosExtra =
          "1";

        element.addEventListener(
          "click",
          () =>
            openSubjectStats(
              "Chemistry"
            )
        );
      }

      if (
        text.includes(
          "biology stats"
        )
      ) {
        element.dataset.neetosExtra =
          "1";

        element.addEventListener(
          "click",
          () =>
            openSubjectStats(
              "Biology"
            )
        );
      }
    }
  );
}


/* =========================================================
   GLOBAL KEYBOARD SHORTCUTS
========================================================= */

function setupKeyboardShortcuts() {
  document.addEventListener(
    "keydown",
    event => {

      /*
         Escape:
         close modal.
      */

      if (
        event.key ===
        "Escape"
      ) {
        closeOverlay();
        closeTaskModal();
      }

      /*
         Ctrl + Shift + B:
         backup panel.
      */

      if (
        event.ctrlKey &&
        event.shiftKey &&
        event.key.toLowerCase() ===
          "b"
      ) {
        event.preventDefault();

        openBackup();
      }
    }
  );
}


/* =========================================================
   PAGE VISIBILITY
========================================================= */

document.addEventListener(
  "visibilitychange",
  () => {

    if (
      document.visibilityState ===
      "visible"
    ) {
      /*
         Immediately refresh when
         returning to the app.
      */

      checkDailyRollover();

      updateDateHeader();

      updateHomeHeader();

      renderTasks();

      updateProgress();

      updateStats();

      updateHomeDashboard();

      updateActiveTimer();

      updateTaskStatusLabels();
    }
  }
);


/* =========================================================
   ONLINE / OFFLINE STATUS
========================================================= */

function updateConnectionStatus() {
  const online =
    navigator.onLine;

  document
    .querySelectorAll(
      "[data-connection-status]"
    )
    .forEach(
      element => {
        element.textContent =
          online
            ? "Online"
            : "Offline";
      }
    );
}


window.addEventListener(
  "online",
  updateConnectionStatus
);

window.addEventListener(
  "offline",
  updateConnectionStatus
);


/* =========================================================
   STORAGE STATUS
========================================================= */

function getStorageStatus() {
  try {
    const localStorageOK =
      typeof localStorage !==
      "undefined";

    const indexedDBOK =
      "indexedDB" in window;

    return {
      localStorage:
        localStorageOK,

      indexedDB:
        indexedDBOK,

      persistent:
        !!(
          navigator.storage &&
          navigator.storage.persist
        )
    };

  } catch {
    return {
      localStorage: false,
      indexedDB: false,
      persistent: false
    };
  }
}


function openStorageStatus() {
  const status =
    getStorageStatus();

  modalBox(
    "Storage Status",

    `
      <div class="neetos-list">

        <div class="neetos-item">
          Local Storage:
          <b>
            ${
              status.localStorage
                ? "Available"
                : "Unavailable"
            }
          </b>
        </div>

        <div class="neetos-item">
          IndexedDB:
          <b>
            ${
              status.indexedDB
                ? "Available"
                : "Unavailable"
            }
          </b>
        </div>

        <div class="neetos-item">
          Persistent Storage API:
          <b>
            ${
              status.persistent
                ? "Available"
                : "Unavailable"
            }
          </b>
        </div>

      </div>
    `
  );
}


/* =========================================================
   ROBUST STORAGE UPGRADE
   IndexedDB + localStorage mirror
========================================================= */

(function NEETOSStorageUpgrade() {

  const DB_NAME =
    "NEET_OS_DB";

  const DB_VERSION =
    1;

  const STORE_NAME =
    "data";

  const IMPORTANT_KEYS =
    new Set([
      STORAGE_KEY,
      HISTORY_KEY,
      SYLLABUS_KEY,
      SETTINGS_KEY
    ]);

  let db =
    null;


  function openDatabase() {
    return new Promise(
      (resolve, reject) => {

        if (
          !("indexedDB" in window)
        ) {
          reject(
            new Error(
              "IndexedDB not supported"
            )
          );

          return;
        }

        const request =
          indexedDB.open(
            DB_NAME,
            DB_VERSION
          );

        request.onupgradeneeded =
          function () {
            const database =
              request.result;

            if (
              !database
                .objectStoreNames
                .contains(
                  STORE_NAME
                )
            ) {
              database.createObjectStore(
                STORE_NAME
              );
            }
          };

        request.onsuccess =
          function () {
            db =
              request.result;

            resolve(db);
          };

        request.onerror =
          function () {
            reject(
              request.error
            );
          };
      }
    );
  }


  function dbWrite(
    key,
    value
  ) {
    if (
      !db ||
      !IMPORTANT_KEYS.has(
        key
      )
    ) {
      return Promise.resolve();
    }

    return new Promise(
      resolve => {

        try {

          const tx =
            db.transaction(
              STORE_NAME,
              "readwrite"
            );

          const store =
            tx.objectStore(
              STORE_NAME
            );

          store.put(
            {
              key,
              value,
              savedAt:
                Date.now()
            },
            key
          );

          tx.oncomplete =
            () => resolve();

          tx.onerror =
            () => resolve();

        } catch {
          resolve();
        }
      }
    );
  }


  function dbRead(key) {
    if (
      !db ||
      !IMPORTANT_KEYS.has(
        key
      )
    ) {
      return Promise.resolve(
        null
      );
    }

    return new Promise(
      resolve => {

        try {

          const tx =
            db.transaction(
              STORE_NAME,
              "readonly"
            );

          const store =
            tx.objectStore(
              STORE_NAME
            );

          const request =
            store.get(key);

          request.onsuccess =
            function () {
              resolve(
                request.result ||
                  null
              );
            };

          request.onerror =
            function () {
              resolve(null);
            };

        } catch {
          resolve(null);
        }
      }
    );
  }


  async function migrateExistingData() {
    for (
      const key of
        IMPORTANT_KEYS
    ) {

      try {

        const localValue =
          localStorage.getItem(
            key
          );

        if (
          localValue !==
          null
        ) {

          const existing =
            await dbRead(
              key
            );

          if (!existing) {

            await dbWrite(
              key,
              localValue
            );
          }
        }

      } catch (error) {

        console.warn(
          "NEET OS migration warning:",
          key,
          error
        );
      }
    }
  }


  async function restoreMissingData() {
    for (
      const key of
        IMPORTANT_KEYS
    ) {

      try {

        const localValue =
          localStorage.getItem(
            key
          );

        if (
          localValue ===
          null
        ) {

          const record =
            await dbRead(
              key
            );

          if (
            record &&
            record.value !==
              undefined
          ) {

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

      } catch (error) {

        console.warn(
          "NEET OS restore warning:",
          key,
          error
        );
      }
    }
  }


  /*
     Mirror important localStorage
     writes into IndexedDB.
  */

  const originalSetItem =
    Storage.prototype.setItem;

  Storage.prototype.setItem =
    function (
      key,
      value
    ) {

      originalSetItem.call(
        this,
        key,
        value
      );

      if (
        this ===
          window.localStorage &&
        IMPORTANT_KEYS.has(
          String(key)
        )
      ) {

        dbWrite(
          String(key),
          String(value)
        ).catch(
          () => {}
        );
      }
    };


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
          persistent
            ? "enabled"
            : "not granted"
        );
      }

    } catch (error) {

      console.warn(
        "NEET OS persistent storage unavailable:",
        error
      );
    }
  }


  window.NEETOSStorage = {

    status:
      function () {
        return {
          database:
            DB_NAME,

          indexedDB:
            !!db,

          localStorage:
            true
        };
      },


    save:
      async function (key) {

        if (
          !IMPORTANT_KEYS.has(
            key
          )
        ) {
          return false;
        }

        const value =
          localStorage.getItem(
            key
          );

        if (
          value === null
        ) {
          return false;
        }

        await dbWrite(
          key,
          value
        );

        return true;
      },


    restore:
      restoreMissingData
  };


  async function initializeStorage() {
    try {

      await openDatabase();

      /*
         Restore first.
      */

      await restoreMissingData();

      /*
         Then migrate existing
         localStorage data.
      */

      await migrateExistingData();

      /*
         Ask browser for persistent
         storage.
      */

      await requestPersistentStorage();

      console.log(
        "NEET OS: Robust storage system ready."
      );

    } catch (error) {

      console.warn(
        "NEET OS: IndexedDB unavailable. " +
        "Continuing with localStorage.",
        error
      );
    }
  }


  initializeStorage();

})();


/* =========================================================
   STORAGE PERIODIC SYNC
========================================================= */

setInterval(
  async () => {

    try {

      if (
        window.NEETOSStorage
      ) {

        await window
          .NEETOSStorage
          .save(
            STORAGE_KEY
          );

        await window
          .NEETOSStorage
          .save(
            HISTORY_KEY
          );

        await window
          .NEETOSStorage
          .save(
            SYLLABUS_KEY
          );

        await window
          .NEETOSStorage
          .save(
            SETTINGS_KEY
          );
      }

    } catch (error) {

      console.warn(
        "NEET OS storage sync warning:",
        error
      );
    }

  },
  30000
);


/* =========================================================
   FINAL UI REFRESH EXTENSION
========================================================= */

function refreshAllUI() {
  try {

    checkDailyRollover();

    updateDateHeader();

    updateHomeHeader();

    renderTasks();

    updateProgress();

    updateStats();

    updateHomeDashboard();

    updateActiveTimer();

    updateTaskStatusLabels();

    updateConnectionStatus();

  } catch (error) {

    console.error(
      "NEET OS UI refresh error:",
      error
    );
  }
}


/* =========================================================
   EXTEND INITIALIZATION
========================================================= */

const originalInitializeNEETOS =
  initializeNEETOS;

initializeNEETOS =
  function () {

    originalInitializeNEETOS();

    /*
       Extra features are attached
       after the original UI exists.
    */

    setupSubjectStatsButtons();

    setupMoreExtraFeatures();

    setupKeyboardShortcuts();

    updateConnectionStatus();

    refreshAllUI();
  };


/*
   If initialization already happened
   before this extension was defined,
   run the extra setup once.
*/

if (
  initialized
) {
  setupSubjectStatsButtons();

  setupMoreExtraFeatures();

  setupKeyboardShortcuts();

  updateConnectionStatus();

  refreshAllUI();
}


/* =========================================================
   EXTRA LIVE LOOP
========================================================= */

setInterval(
  () => {

    if (!data) {
      return;
    }

    updateActiveTimer();

    updateHomeDashboard();

    updateTaskStatusLabels();

  },
  1000
);


/* =========================================================
   DEBUG INFORMATION
========================================================= */

window.NEETOSDebug = {

  getStudyDay:
    () =>
      getStudyDayKey(),

  getCalendarDay:
    () =>
      calendarDayKey(),

  getWeekInfo:
    () =>
      getWeekInfo(),

  getProgress:
    () => ({
      completed:
        getCompletedTaskCount(),

      total:
        8,

      percentage:
        Math.round(
          (
            getCompletedTaskCount() /
            8
          ) *
          100
        )
    }),

  getStudyTime:
    () =>
      getTotalStudySeconds(),

  getQuestions:
    () =>
      getTotalQuestions(),

  storage:
    () =>
      window.NEETOSStorage
        ?.status?.(),

  data:
    () =>
      data
};


/* =========================================================
   FINAL SAFETY CHECK
========================================================= */

window.addEventListener(
  "error",
  event => {
    console.error(
      "NEET OS runtime error:",
      event.error ||
        event.message
    );
  }
);


window.addEventListener(
  "unhandledrejection",
  event => {
    console.error(
      "NEET OS promise error:",
      event.reason
    );
  }
);


/* =========================================================
   END OF PART 2
========================================================= *//* =========================================================
   NEET OS — PART 3
   ADVANCED DAILY TRACKING
========================================================= */


/* =========================================================
   REPAIR TRACKING
========================================================= */

function getRepairLog() {
  if (
    !data ||
    !Array.isArray(data.repairLog)
  ) {
    return [];
  }

  return data.repairLog;
}


function addRepairEntry(
  taskIndex,
  reason,
  completedLater = false
) {
  if (!data) {
    return;
  }

  if (
    !Array.isArray(
      data.repairLog
    )
  ) {
    data.repairLog = [];
  }

  data.repairLog.push({
    date:
      getStudyDayKey(),

    taskIndex:
      Number(taskIndex),

    taskName:
      tasks[taskIndex]?.name ||
      "Unknown Task",

    reason:
      String(
        reason ||
          "Not specified"
      ),

    completedLater:
      !!completedLater,

    createdAt:
      Date.now()
  });

  saveData();
}


function openRepairLog() {
  const log =
    getRepairLog();

  if (!log.length) {
    modalBox(
      "Repair History",
      `
        <div class="neetos-item">
          No repair entries yet.
        </div>
      `
    );

    return;
  }

  const recent =
    log
      .slice()
      .reverse()
      .slice(0, 50);

  const html =
    `
      <div class="neetos-list">

        ${recent.map(
          entry => {

            const taskName =
              tasks[
                Number(
                  entry.taskIndex
                )
              ]?.name ||
              entry.taskName ||
              "Unknown Task";

            return `
              <div class="neetos-item">

                <b>
                  ${esc(taskName)}
                </b>

                <br>

                <small>
                  ${esc(
                    entry.date || ""
                  )}
                </small>

                <br>

                Reason:
                ${esc(
                  entry.reason ||
                    "Not specified"
                )}

                <br>

                Status:
                ${
                  entry.completedLater
                    ? "Repaired"
                    : "Pending"
                }

              </div>
            `;
          }
        ).join("")}

      </div>
    `;

  modalBox(
    "Repair History",
    html
  );
}


/* =========================================================
   MISSED TASK ENHANCEMENT
========================================================= */

function getMissedTaskEntries() {
  const current =
    getCurrentMinutes();

  return tasks
    .map(
      (task, index) => ({
        task,
        index
      })
    )
    .filter(
      ({ task, index }) => {

        if (
          !isProgressTask(index)
        ) {
          return false;
        }

        if (
          data.completed[index]
        ) {
          return false;
        }

        if (
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
           Normal daytime task.
        */

        if (
          end > start
        ) {
          return current >= end;
        }

        /*
           Overnight task.
        */

        return (
          current >= end &&
          current < start
        );
      }
    );
}


function markTaskForRepair(
  index
) {
  const task =
    tasks[index];

  if (!task) {
    return;
  }

  const reason =
    prompt(
      `Why was "${task.name}" missed?`,
      ""
    );

  if (
    reason === null
  ) {
    return;
  }

  data.missedReasons[index] =
    reason ||
    "Not specified";

  addRepairEntry(
    index,
    reason,
    false
  );

  alert(
    "Repair entry saved."
  );

  renderTasks();
  updateProgress();
  updateStats();
}


/* =========================================================
   IMPROVED MISSED TASK PANEL
========================================================= */

function openMissedTasksEnhanced() {
  const missed =
    getMissedTaskEntries();

  if (!missed.length) {
    modalBox(
      "Missed Tasks",
      `
        <div class="neetos-item">
          <b>
            No missed scheduled task right now.
          </b>
        </div>
      `
    );

    return;
  }

  const html =
    `
      <div class="neetos-list">

        ${missed.map(
          ({ task, index }) => `
            <div
              class="neetos-item"
              data-missed-card="${index}"
            >

              <b>
                ${esc(task.name)}
              </b>

              <br>

              <small>
                ${esc(
                  formatRange(task)
                )}
              </small>

              <br><br>

              <button
                class="ns"
                data-record-repair="${index}"
              >
                Record Repair
              </button>

            </div>
          `
        ).join("")}

      </div>
    `;

  modalBox(
    "Missed Tasks",
    html
  );

  document
    .querySelectorAll(
      "[data-record-repair]"
    )
    .forEach(
      button => {

        button.addEventListener(
          "click",
          () => {

            const index =
              Number(
                button.dataset
                  .recordRepair
              );

            markTaskForRepair(
              index
            );

            closeOverlay();

            openMissedTasksEnhanced();
          }
        );

      }
    );
}


/* =========================================================
   DAILY TARGETS
========================================================= */

function getDailyTargets() {
  return {
    studyHours: 10,
    questions: 180,
    tasks: 8
  };
}


function getDailyTargetStatus() {
  const targets =
    getDailyTargets();

  const studySeconds =
    getTotalStudySeconds();

  const questions =
    getTotalQuestions();

  const completed =
    getCompletedTaskCount();

  return {
    study: {
      current:
        studySeconds,

      target:
        targets.studyHours *
        3600,

      percentage:
        Math.min(
          100,
          Math.round(
            (
              studySeconds /
              (
                targets.studyHours *
                3600
              )
            ) *
            100
          )
        )
    },

    questions: {
      current:
        questions,

      target:
        targets.questions,

      percentage:
        Math.min(
          100,
          Math.round(
            (
              questions /
              targets.questions
            ) *
            100
          )
        )
    },

    tasks: {
      current:
        completed,

      target:
        targets.tasks,

      percentage:
        Math.min(
          100,
          Math.round(
            (
              completed /
              targets.tasks
            ) *
            100
          )
        )
    }
  };
}


/* =========================================================
   TARGET PANEL
========================================================= */

function openDailyTargets() {
  const status =
    getDailyTargetStatus();

  modalBox(
    "Daily Targets",

    `
      <div class="neetos-list">

        <div class="neetos-item">

          <b>
            Study Time
          </b>

          <br>

          ${shortDuration(
            status.study.current
          )}

          /
          ${shortDuration(
            status.study.target
          )}

          <br>

          ${status.study.percentage}%

        </div>


        <div class="neetos-item">

          <b>
            Questions
          </b>

          <br>

          ${status.questions.current}
          /
          ${status.questions.target}

          <br>

          ${status.questions.percentage}%

        </div>


        <div class="neetos-item">

          <b>
            Scheduled Tasks
          </b>

          <br>

          ${status.tasks.current}
          /
          ${status.tasks.target}

          <br>

          ${status.tasks.percentage}%

        </div>

      </div>
    `
  );
}


/* =========================================================
   DAILY CONSISTENCY
========================================================= */

function calculateConsistency(
  records
) {
  if (
    !records ||
    !records.length
  ) {
    return 0;
  }

  let goodDays = 0;

  records.forEach(
    record => {

      const score =
        calculateDayScore(
          record
        );

      if (
        score >= 70
      ) {
        goodDays++;
      }
    }
  );

  return Math.round(
    (
      goodDays /
      records.length
    ) *
    100
  );
}


function getLast7DaysConsistency() {
  const records =
    getHistoryWithCurrent()
      .slice(-7);

  return calculateConsistency(
    records
  );
}


/* =========================================================
   CONSISTENCY PANEL
========================================================= */

function openConsistency() {
  const records =
    getHistoryWithCurrent();

  const recent =
    records.slice(-7);

  const consistency =
    calculateConsistency(
      recent
    );

  modalBox(
    "Consistency",

    `
      <div class="neetos-list">

        <div class="neetos-item">

          Last 7 days:
          <b>
            ${consistency}%
          </b>

        </div>

        <div class="neetos-item">

          Days with 70%+ score:
          <b>
            ${
              recent.filter(
                record =>
                  calculateDayScore(
                    record
                  ) >= 70
              ).length
            }
            /
            ${recent.length}
          </b>

        </div>

      </div>
    `
  );
}


/* =========================================================
   STUDY TIME BY TASK
========================================================= */

function getTaskBreakdown() {
  return tasks.map(
    (task, index) => ({
      index,

      name:
        task.name,

      seconds:
        getTaskStudySeconds(
          index
        ),

      questions:
        getTaskQuestionCount(
          index
        ),

      completed:
        !!data.completed[index]
    })
  );
}


function openTaskBreakdown() {
  const breakdown =
    getTaskBreakdown();

  const html =
    `
      <div class="neetos-list">

        ${breakdown.map(
          item => `
            <div class="neetos-item">

              <b>
                ${esc(item.name)}
              </b>

              <br>

              Time:
              ${shortDuration(
                item.seconds
              )}

              ${
                item.questions
                  ? `
                    <br>
                    Questions:
                    ${item.questions}
                  `
                  : ""
              }

              <br>

              Status:
              ${
                item.completed
                  ? "✓ Done"
                  : "Pending"
              }

            </div>
          `
        ).join("")}

      </div>
    `;

  modalBox(
    "Today's Task Breakdown",
    html
  );
}


/* =========================================================
   HISTORY DAY DETAILS
========================================================= */

function openHistoryDay(
  key
) {
  const record =
    getRecordForDate(
      key
    );

  if (!record) {
    modalBox(
      key,
      `
        <div class="neetos-item">
          No data recorded for this day.
        </div>
      `
    );

    return;
  }

  const score =
    calculateDayScore(
      record
    );

  modalBox(
    `Study Day — ${key}`,

    `
      <div class="neetos-list">

        <div class="neetos-item">
          Study:
          <b>
            ${shortDuration(
              record.totalStudySeconds ||
                0
            )}
          </b>
        </div>

        <div class="neetos-item">
          Questions:
          <b>
            ${
              record.totalQuestions ||
              0
            }
          </b>
        </div>

        <div class="neetos-item">
          Tasks:
          <b>
            ${
              record.completedCount ||
              0
            }
            / 8
          </b>
        </div>

        <div class="neetos-item">
          Score:
          <b>
            ${score}%
          </b>
        </div>

      </div>
    `
  );
}


/* =========================================================
   HISTORY BROWSER
========================================================= */

function openHistoryBrowser() {
  const records =
    getHistoryWithCurrent()
      .slice()
      .reverse()
      .slice(0, 30);

  if (!records.length) {
    modalBox(
      "Study History",
      `
        <div class="neetos-item">
          No history available yet.
        </div>
      `
    );

    return;
  }

  const html =
    `
      <div class="neetos-list">

        ${records.map(
          record => {

            const score =
              calculateDayScore(
                record
              );

            return `
              <button
                class="neetos-item"
                data-history-date="${esc(
                  record.date
                )}"
                style="
                  width:100%;
                  text-align:left;
                  border:0;
                  color:inherit;
                  cursor:pointer;
                "
              >

                <b>
                  ${esc(
                    record.date
                  )}
                </b>

                <br>

                Study:
                ${shortDuration(
                  record.totalStudySeconds ||
                    0
                )}

                •
                Questions:
                ${
                  record.totalQuestions ||
                  0
                }

                •
                Score:
                ${score}%

              </button>
            `;
          }
        ).join("")}

      </div>
    `;

  modalBox(
    "Study History",
    html
  );

  document
    .querySelectorAll(
      "[data-history-date]"
    )
    .forEach(
      button => {

        button.addEventListener(
          "click",
          () => {

            const key =
              button.dataset
                .historyDate;

            closeOverlay();

            openHistoryDay(
              key
            );
          }
        );

      }
    );
}


/* =========================================================
   WEEKLY REPORT
========================================================= */

function getWeekRecords(
  weekNumber
) {
  const records =
    getHistoryWithCurrent();

  return records.filter(
    record => {

      const info =
        getWeekInfo(
          record.date
        );

      return (
        info.week ===
        weekNumber
      );
    }
  );
}


function openWeeklyReport(
  weekNumber =
    getWeekInfo().week
) {
  const records =
    getWeekRecords(
      weekNumber
    );

  const totalStudy =
    records.reduce(
      (sum, record) =>
        sum +
        Number(
          record.totalStudySeconds ||
            0
        ),
      0
    );

  const totalQuestions =
    records.reduce(
      (sum, record) =>
        sum +
        Number(
          record.totalQuestions ||
            0
        ),
      0
    );

  const totalTasks =
    records.reduce(
      (sum, record) =>
        sum +
        Number(
          record.completedCount ||
            0
        ),
      0
    );

  const averageScore =
    records.length
      ? Math.round(
          records.reduce(
            (sum, record) =>
              sum +
              calculateDayScore(
                record
              ),
            0
          ) /
            records.length
        )
      : 0;

  modalBox(
    `Week ${weekNumber} Report`,

    `
      <div class="neetos-list">

        <div class="neetos-item">
          Days recorded:
          <b>
            ${records.length} / 7
          </b>
        </div>

        <div class="neetos-item">
          Study time:
          <b>
            ${shortDuration(
              totalStudy
            )}
          </b>
        </div>

        <div class="neetos-item">
          Questions:
          <b>
            ${totalQuestions}
          </b>
        </div>

        <div class="neetos-item">
          Tasks completed:
          <b>
            ${totalTasks}
          </b>
        </div>

        <div class="neetos-item">
          Average score:
          <b>
            ${averageScore}%
          </b>
        </div>

      </div>
    `
  );
}


/* =========================================================
   WEEK SELECTOR
========================================================= */

function openWeekSelector() {
  const currentWeek =
    getWeekInfo().week;

  const html =
    `
      <label>

        Select Week

        <input
          id="weekSelectorInput"
          type="number"
          min="1"
          max="52"
          value="${currentWeek}"
        >

      </label>
    `;

  modalBox(
    "Weekly Report",
    html,
    [
      {
        label:
          "Open Report",

        primary:
          true,

        onClick:
          () => {

            const week =
              Math.max(
                1,
                Number(
                  $("weekSelectorInput")
                    ?.value ||
                    currentWeek
                )
              );

            closeOverlay();

            openWeeklyReport(
              week
            );
          }
      }
    ]
  );
}


/* =========================================================
   MONTHLY OVERVIEW
========================================================= */

function openMonthlyOverview() {
  const records =
    getHistoryWithCurrent();

  const now =
    new Date();

  const year =
    now.getFullYear();

  const month =
    now.getMonth();

  const monthly =
    records.filter(
      record => {

        const d =
          parseDate(
            record.date
          );

        return (
          d.getFullYear() ===
            year &&
          d.getMonth() ===
            month
        );
      }
    );

  const study =
    monthly.reduce(
      (sum, record) =>
        sum +
        Number(
          record.totalStudySeconds ||
            0
        ),
      0
    );

  const questions =
    monthly.reduce(
      (sum, record) =>
        sum +
        Number(
          record.totalQuestions ||
            0
        ),
      0
    );

  const average =
    monthly.length
      ? Math.round(
          monthly.reduce(
            (sum, record) =>
              sum +
              calculateDayScore(
                record
              ),
            0
          ) /
            monthly.length
        )
      : 0;

  modalBox(
    "This Month",

    `
      <div class="neetos-list">

        <div class="neetos-item">
          Days studied:
          <b>
            ${monthly.length}
          </b>
        </div>

        <div class="neetos-item">
          Study time:
          <b>
            ${shortDuration(
              study
            )}
          </b>
        </div>

        <div class="neetos-item">
          Questions:
          <b>
            ${questions}
          </b>
        </div>

        <div class="neetos-item">
          Average score:
          <b>
            ${average}%
          </b>
        </div>

      </div>
    `
  );
}


/* =========================================================
   APP MENU ACTION ROUTER
========================================================= */

function routeMoreAction(
  text
) {
  const value =
    String(text || "")
      .toLowerCase()
      .trim();

  if (
    value.includes(
      "notification"
    ) ||
    value.includes(
      "reminder"
    )
  ) {
    openNotificationPanel();

    return true;
  }

  if (
    value.includes(
      "daily summary"
    ) ||
    value.includes(
      "today summary"
    )
  ) {
    openDailySummary();

    return true;
  }

  if (
    value.includes(
      "daily target"
    ) ||
    value.includes(
      "target"
    )
  ) {
    openDailyTargets();

    return true;
  }

  if (
    value.includes(
      "missed"
    )
  ) {
    openMissedTasksEnhanced();

    return true;
  }

  if (
    value.includes(
      "repair history"
    )
  ) {
    openRepairLog();

    return true;
  }

  if (
    value.includes(
      "history"
    )
  ) {
    openHistoryBrowser();

    return true;
  }

  if (
    value.includes(
      "weekly"
    )
  ) {
    openWeekSelector();

    return true;
  }

  if (
    value.includes(
      "monthly"
    )
  ) {
    openMonthlyOverview();

    return true;
  }

  if (
    value.includes(
      "consistency"
    )
  ) {
    openConsistency();

    return true;
  }

  if (
    value.includes(
      "task breakdown"
    )
  ) {
    openTaskBreakdown();

    return true;
  }

  if (
    value.includes(
      "sunday test"
    )
  ) {
    openSundayTest();

    return true;
  }

  if (
    value.includes(
      "analytics"
    )
  ) {
    openAnalytics();

    return true;
  }

  if (
    value.includes(
      "personal best"
    )
  ) {
    openPersonalBest();

    return true;
  }

  if (
    value.includes(
      "sleep"
    )
  ) {
    openSleepTracking();

    return true;
  }

  if (
    value.includes(
      "backup"
    )
  ) {
    openBackup();

    return true;
  }

  if (
    value.includes(
      "storage"
    )
  ) {
    openStorageStatus();

    return true;
  }

  if (
    value.includes(
      "setting"
    )
  ) {
    openSettings();

    return true;
  }

  return false;
}


/* =========================================================
   MORE MENU ROUTING
========================================================= */

function setupMoreActionRouter() {
  document
    .querySelectorAll(
      "#moreSection .feature-row, #moreSection button"
    )
    .forEach(
      element => {

        if (
          element.dataset
            .neetosRouterBound
        ) {
          return;
        }

        const text =
          element.textContent ||
          "";

        /*
           Only attach if one of
           our known actions matches.
        */

        const known =
          routeMoreAction;

        if (
          typeof known !==
          "function"
        ) {
          return;
        }

        const lower =
          text.toLowerCase();

        const shouldBind =
          [
            "notification",
            "reminder",
            "summary",
            "target",
            "missed",
            "repair",
            "history",
            "weekly",
            "monthly",
            "consistency",
            "breakdown",
            "sunday",
            "analytics",
            "personal best",
            "sleep",
            "backup",
            "storage",
            "setting"
          ].some(
            keyword =>
              lower.includes(
                keyword
              )
          );

        if (!shouldBind) {
          return;
        }

        element.dataset
          .neetosRouterBound =
          "1";

        element.classList.add(
          "neetos-click"
        );

        element.addEventListener(
          "click",
          event => {

            event.preventDefault();
            event.stopPropagation();

            routeMoreAction(
              text
            );
          }
        );
      }
    );
}


/* =========================================================
   DATE / WEEK / DAY AUTO REFRESH
========================================================= */

let lastCalendarDay =
  calendarDayKey();

let lastStudyDay =
  getStudyDayKey();


function monitorDateBoundary() {
  const calendar =
    calendarDayKey();

  const study =
    getStudyDayKey();

  /*
     Midnight:
     update only visible
     calendar information.
  */

  if (
    calendar !==
    lastCalendarDay
  ) {

    lastCalendarDay =
      calendar;

    updateDateHeader();

    updateHomeHeader();

    updateHomeDashboard();
  }

  /*
     03:00:
     rollover study progress.
  */

  if (
    study !==
    lastStudyDay
  ) {

    lastStudyDay =
      study;

    checkDailyRollover();

    refreshAllUI();
  }
}


/* =========================================================
   PROGRESS ARCHIVE SAFETY
========================================================= */

function archiveBeforeUnload() {
  if (
    !data ||
    !data.date
  ) {
    return;
  }

  try {

    /*
       Don't archive current day
       automatically here.

       Just save current state.
    */

    saveData();

  } catch (error) {

    console.warn(
      "NEET OS unload save warning:",
      error
    );
  }
}


window.addEventListener(
  "pagehide",
  archiveBeforeUnload
);


/* =========================================================
   VISIBILITY RECOVERY
========================================================= */

function recoverAfterSleep() {
  if (!data) {
    return;
  }

  checkDailyRollover();

  updateDateHeader();

  updateHomeHeader();

  renderTasks();

  updateProgress();

  updateStats();

  updateHomeDashboard();

  updateActiveTimer();

  updateTaskStatusLabels();

  updateConnectionStatus();
}


document.addEventListener(
  "visibilitychange",
  () => {

    if (
      document.visibilityState ===
      "visible"
    ) {
      recoverAfterSleep();
    }
  }
);


/* =========================================================
   CLOCK CHANGE DETECTION
========================================================= */

let lastKnownMinute =
  getCurrentMinutes();


function detectClockChange() {
  const current =
    getCurrentMinutes();

  if (
    current !==
    lastKnownMinute
  ) {

    lastKnownMinute =
      current;

    renderTasks();

    updateProgress();

    updateTaskStatusLabels();
  }
}


/* =========================================================
   FINAL SECONDARY LOOP
========================================================= */

setInterval(
  () => {

    if (!data) {
      return;
    }

    monitorDateBoundary();

    detectClockChange();

    updateActiveTimer();

    updateHomeDashboard();

  },
  1000
);


/* =========================================================
   MANUAL REFRESH API
========================================================= */

window.NEETOS.refresh =
  function () {

    refreshAllUI();

    renderSyllabus();

    setupSubjectStatsButtons();

    setupMoreExtraFeatures();

    setupMoreActionRouter();

    return true;
  };


/* =========================================================
   REPORT API
========================================================= */

window.NEETOS.report =
  function () {

    return {
      today:
        buildDailySummary(),

      targets:
        getDailyTargetStatus(),

      consistency:
        getLast7DaysConsistency(),

      bestStudy:
        getBestStudySeconds(),

      bestQuestions:
        getBestQuestionCount()
    };
  };


/* =========================================================
   HISTORY API
========================================================= */

window.NEETOS.history =
  function () {

    return getHistoryWithCurrent()
      .slice()
      .reverse();
  };


/* =========================================================
   SYLLABUS API
========================================================= */

window.NEETOS.syllabus =
  function () {

    return {
      syllabus:
        SYLLABUS,

      completed:
        getSyllabusState()
    };
  };


/* =========================================================
   TEST HELPERS
========================================================= */

window.NEETOS.testDate =
  function () {

    return {
      calendarDate:
        calendarDayKey(),

      studyDay:
        getStudyDayKey(),

      week:
        getWeekInfo()
    };
  };


window.NEETOS.testRollover =
  function () {

    checkDailyRollover();

    refreshAllUI();

    return {
      studyDay:
        getStudyDayKey(),

      dataDate:
        data?.date
    };
  };


/* =========================================================
   END OF PART 3
========================================================= *//* =========================================================
   NEET OS — PART 4
   FINAL EVENT BINDINGS + SAFETY
========================================================= */


/* =========================================================
   EXTRA MORE MENU BINDINGS
========================================================= */

function bindMoreMenuActionsFinal() {

  const items =
    document.querySelectorAll(
      "#moreSection .feature-row, " +
      "#moreSection button, " +
      "#moreSection .more-item"
    );

  items.forEach(
    item => {

      if (
        item.dataset.neetosFinalBound
      ) {
        return;
      }

      const text =
        (
          item.textContent ||
          ""
        ).trim();

      if (!text) {
        return;
      }

      const lower =
        text.toLowerCase();

      let handler = null;

      if (
        lower.includes(
          "notification"
        ) ||
        lower.includes(
          "reminder"
        )
      ) {
        handler =
          openNotificationPanel;
      }

      else if (
        lower.includes(
          "daily summary"
        ) ||
        lower.includes(
          "today summary"
        )
      ) {
        handler =
          openDailySummary;
      }

      else if (
        lower.includes(
          "daily target"
        )
      ) {
        handler =
          openDailyTargets;
      }

      else if (
        lower.includes(
          "missed task"
        )
      ) {
        handler =
          openMissedTasksEnhanced;
      }

      else if (
        lower.includes(
          "repair history"
        )
      ) {
        handler =
          openRepairLog;
      }

      else if (
        lower.includes(
          "study history"
        )
      ) {
        handler =
          openHistoryBrowser;
      }

      else if (
        lower.includes(
          "weekly report"
        )
      ) {
        handler =
          openWeekSelector;
      }

      else if (
        lower.includes(
          "monthly"
        )
      ) {
        handler =
          openMonthlyOverview;
      }

      else if (
        lower.includes(
          "consistency"
        )
      ) {
        handler =
          openConsistency;
      }

      else if (
        lower.includes(
          "task breakdown"
        )
      ) {
        handler =
          openTaskBreakdown;
      }

      else if (
        lower.includes(
          "sunday test"
        )
      ) {
        handler =
          openSundayTest;
      }

      else if (
        lower.includes(
          "analytics"
        )
      ) {
        handler =
          openAnalytics;
      }

      else if (
        lower.includes(
          "personal best"
        )
      ) {
        handler =
          openPersonalBest;
      }

      else if (
        lower.includes(
          "sleep"
        )
      ) {
        handler =
          openSleepTracking;
      }

      else if (
        lower.includes(
          "storage"
        )
      ) {
        handler =
          openStorageStatus;
      }

      else if (
        lower.includes(
          "backup"
        )
      ) {
        handler =
          openBackup;
      }

      else if (
        lower.includes(
          "setting"
        )
      ) {
        handler =
          openSettings;
      }

      if (
        typeof handler !==
        "function"
      ) {
        return;
      }

      item.dataset
        .neetosFinalBound =
        "1";

      item.classList.add(
        "neetos-click"
      );

      item.addEventListener(
        "click",
        event => {

          event.preventDefault();

          event.stopPropagation();

          handler();

        }
      );
    }
  );
}


/* =========================================================
   QUICK STATS
========================================================= */

function updateQuickStats() {

  const completed =
    getCompletedTaskCount();

  const questions =
    getTotalQuestions();

  const studySeconds =
    getTotalStudySeconds();

  const values = {
    completed,
    questions,
    studySeconds
  };


  document
    .querySelectorAll(
      "[data-quick-stat]"
    )
    .forEach(
      element => {

        const type =
          element.dataset
            .quickStat;

        if (
          type ===
          "completed"
        ) {
          element.textContent =
            completed;
        }

        else if (
          type ===
          "questions"
        ) {
          element.textContent =
            questions;
        }

        else if (
          type ===
          "study"
        ) {
          element.textContent =
            shortDuration(
              studySeconds
            );
        }

      }
    );

  return values;
}


/* =========================================================
   TASK CARD EXTRA INFORMATION
========================================================= */

function updateTaskCardsFinal() {

  document
    .querySelectorAll(
      ".start-button"
    )
    .forEach(
      (button, index) => {

        const task =
          tasks[index];

        if (!task) {
          return;
        }

        const card =
          getTaskCard(button);

        if (!card) {
          return;
        }

        /*
           Add/update status.
        */

        let status =
          card.querySelector(
            ".neetos-task-status"
          );

        if (!status) {

          status =
            document.createElement(
              "div"
            );

          status.className =
            "neetos-task-status";

          status.style.fontSize =
            "12px";

          status.style.opacity =
            "0.7";

          status.style.marginTop =
            "5px";

          const parent =
            button.parentElement ||
            card;

          parent.appendChild(
            status
          );
        }

        status.textContent =
          taskStatusText(
            index
          );


        /*
           Add study time.
        */

        let time =
          card.querySelector(
            ".neetos-study-time"
          );

        if (!time) {

          time =
            document.createElement(
              "div"
            );

          time.className =
            "neetos-study-time";

          time.style.fontSize =
            "11px";

          time.style.opacity =
            "0.55";

          const parent =
            button.parentElement ||
            card;

          parent.appendChild(
            time
          );
        }

        time.textContent =
          "Study: " +
          shortDuration(
            getTaskStudySeconds(
              index
            )
          );


        /*
           Question count.
        */

        if (task.target) {

          let question =
            card.querySelector(
              ".neetos-question-count"
            );

          if (!question) {

            question =
              document.createElement(
                "div"
              );

            question.className =
              "neetos-question-count";

            question.style.fontSize =
              "11px";

            question.style.opacity =
              "0.55";

            const parent =
              button.parentElement ||
              card;

            parent.appendChild(
              question
            );
          }

          question.textContent =
            `Questions: ${
              getTaskQuestionCount(
                index
              )
            } / ${
              task.target
            }`;
        }

      }
    );
}


/* =========================================================
   DAILY DATE DISPLAY
========================================================= */

function updateAllDateElements() {

  const calendar =
    calendarDayKey();

  const study =
    getStudyDayKey();

  const info =
    getWeekInfo(
      calendar
    );

  const dateObject =
    parseDate(
      calendar
    );

  const formattedDate =
    dateObject.toLocaleDateString(
      "en-IN",
      {
        day:
          "numeric",

        month:
          "long",

        year:
          "numeric"
      }
    );


  /*
     Calendar date.
  */

  document
    .querySelectorAll(
      "[data-calendar-date]"
    )
    .forEach(
      element => {
        element.textContent =
          formattedDate;
      }
    );


  /*
     Week.
  */

  document
    .querySelectorAll(
      "[data-calendar-week]"
    )
    .forEach(
      element => {
        element.textContent =
          `Week ${info.week}`;
      }
    );


  /*
     Day.
  */

  document
    .querySelectorAll(
      "[data-calendar-day]"
    )
    .forEach(
      element => {
        element.textContent =
          `Day ${info.day}`;
      }
    );


  /*
     Study day.

     This deliberately uses
     getStudyDayKey() because
     study day changes only
     at 03:00.
  */

  document
    .querySelectorAll(
      "[data-study-day]"
    )
    .forEach(
      element => {
        element.textContent =
          study;
      }
    );


  return {
    calendar,
    study,
    week:
      info.week,
    day:
      info.day
  };
}


/* =========================================================
   SELF STUDY — REPEATED SESSIONS
========================================================= */

/*
   IMPORTANT:

   Self Study is NOT one of the
   8 scheduled completion tasks.

   It can be started repeatedly.

   Every session adds to
   studySeconds.

   Stopping Self Study does NOT
   permanently mark it Done.
*/

function startSelfStudy() {

  const index =
    tasks.findIndex(
      task =>
        task.type ===
        "self-study"
    );

  if (
    index < 0
  ) {
    return;
  }

  if (
    data.activeTask !==
    null
  ) {

    alert(
      "Another study session is already running."
    );

    return;
  }

  data.activeTask =
    index;

  data.activeStartTime =
    Date.now();

  /*
     Never use completed[]
     for Self Study.
  */

  delete data.completed[
    index
  ];

  saveData();

  renderTasks();

  updateProgress();

  updateStats();
}


/* =========================================================
   SELF STUDY STOP
========================================================= */

function stopSelfStudy(
  index
) {

  if (
    data.activeTask !==
    index
  ) {
    return;
  }

  const elapsed =
    data.activeStartTime
      ? Math.max(
          0,
          Math.floor(
            (
              Date.now() -
              data.activeStartTime
            ) / 1000
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

  /*
     Self Study is repeatable.

     Therefore:
     DO NOT set completed[index]
     to true.
  */

  delete data.completed[
    index
  ];

  saveData();

  renderTasks();

  updateProgress();

  updateStats();

  updateHomeDashboard();
}


/* =========================================================
   PATCH SELF STUDY START BUTTON
========================================================= */

function patchSelfStudyBehavior() {

  const index =
    tasks.findIndex(
      task =>
        task.type ===
        "self-study"
    );

  if (
    index < 0
  ) {
    return;
  }

  document
    .querySelectorAll(
      ".start-button"
    )
    .forEach(
      (button, buttonIndex) => {

        if (
          buttonIndex !==
          index
        ) {
          return;
        }

        /*
           Existing listener may already
           exist, so we cannot remove it.

           Instead, make sure the task
           is never shown as permanently
           completed.
        */

        if (
          data.activeTask !==
          index
        ) {
          delete data.completed[
            index
          ];
        }

        button.disabled =
          data.activeTask !== null &&
          data.activeTask !== index;

        button.textContent =
          data.activeTask === index
            ? "Stop"
            : "Start";

        button.style.opacity =
          data.activeTask === index ||
          data.activeTask === null
            ? "1"
            : "0.45";
      }
    );
}


/* =========================================================
   PATCH STOP TASK FOR SELF STUDY
========================================================= */

const originalStopTask =
  stopTask;

stopTask =
  function(index) {

    const task =
      tasks[index];

    if (
      task?.type ===
      "self-study"
    ) {

      stopSelfStudy(
        index
      );

      return;
    }

    originalStopTask(
      index
    );
  };


/* =========================================================
   PATCH START TASK FOR SELF STUDY
========================================================= */

const originalStartTask =
  startTask;

startTask =
  function(
    index,
    ignoreTime = false
  ) {

    const task =
      tasks[index];

    if (
      task?.type ===
      "self-study"
    ) {

      startSelfStudy();

      return;
    }

    originalStartTask(
      index,
      ignoreTime
    );
  };


/* =========================================================
   PATCH RENDER TASKS FOR SELF STUDY
========================================================= */

const originalRenderTasks =
  renderTasks;

renderTasks =
  function() {

    originalRenderTasks();

    patchSelfStudyBehavior();

    updateTaskCardsFinal();
  };


/* =========================================================
   REFRESH ALL FINAL UI
========================================================= */

function finalRefresh() {

  try {

    checkDailyRollover();

    updateDateHeader();

    updateHomeHeader();

    updateAllDateElements();

    renderTasks();

    updateProgress();

    updateStats();

    updateHomeDashboard();

    updateQuickStats();

    updateActiveTimer();

    updateTaskStatusLabels();

    updateTaskCardsFinal();

    updateConnectionStatus();

  } catch (
    error
  ) {

    console.error(
      "NEET OS final refresh error:",
      error
    );
  }
}


/* =========================================================
   FINAL MENU SETUP
========================================================= */

function finalMenuSetup() {

  try {

    setupMoreActionRouter();

    bindMoreMenuActionsFinal();

    setupSubjectStatsButtons();

  } catch (
    error
  ) {

    console.warn(
      "NEET OS menu setup warning:",
      error
    );
  }
}


/* =========================================================
   FINAL INITIALIZATION
========================================================= */

function runFinalSetup() {

  if (!data) {
    return;
  }

  finalMenuSetup();

  finalRefresh();

  /*
     Make sure notification
     permission state is reflected.
  */

  const settings =
    getSettings();

  if (
    settings.notifications &&
    "Notification" in window &&
    Notification.permission ===
      "granted"
  ) {

    console.log(
      "NEET OS reminders are enabled."
    );
  }


  /*
     Storage diagnostic.
  */

  if (
    window.NEETOSStorage
  ) {

    console.log(
      "NEET OS storage:",
      window.NEETOSStorage.status()
    );
  }


  console.log(
    "NEET OS final setup complete."
  );
}


/*
   Give the browser a moment
   after the existing DOM setup.
*/

setTimeout(
  runFinalSetup,
  100
);


/* =========================================================
   FINAL LIVE LOOP
========================================================= */

setInterval(
  () => {

    if (!data) {
      return;
    }

    /*
       Midnight calendar update.
    */

    const calendar =
      calendarDayKey();

    if (
      calendar !==
      lastCalendarDay
    ) {

      lastCalendarDay =
        calendar;

      updateDateHeader();

      updateHomeHeader();

      updateAllDateElements();

      updateHomeDashboard();
    }


    /*
       03:00 study-day rollover.
    */

    const study =
      getStudyDayKey();

    if (
      study !==
      lastStudyDay
    ) {

      lastStudyDay =
        study;

      checkDailyRollover();

      finalRefresh();
    }


    /*
       Normal live UI.
    */

    updateActiveTimer();

    updateHomeDashboard();

    updateQuickStats();

    updateTaskStatusLabels();

    updateTaskCardsFinal();

    patchSelfStudyBehavior();

  },
  1000
);


/* =========================================================
   FINAL NOTIFICATION LOOP
========================================================= */

let lastNotificationCheck =
  0;


setInterval(
  () => {

    const now =
      Date.now();

    /*
       Prevent excessive calls.
    */

    if (
      now -
        lastNotificationCheck <
      15000
    ) {
      return;
    }

    lastNotificationCheck =
      now;

    void maybeNotifySchedule();

  },
  15000
);


/* =========================================================
   PAGE FOCUS RECOVERY
========================================================= */

window.addEventListener(
  "focus",
  () => {

    if (!data) {
      return;
    }

    finalRefresh();

    finalMenuSetup();

  }
);


/* =========================================================
   MOBILE APP RECOVERY
========================================================= */

window.addEventListener(
  "pageshow",
  () => {

    if (!data) {
      return;
    }

    finalRefresh();

  }
);


/* =========================================================
   BEFORE REFRESH SAFETY
========================================================= */

function saveCurrentSessionSafely() {

  if (
    !data
  ) {
    return;
  }

  /*
     Do not permanently stop
     an active session.

     Save accumulated time up
     to this exact moment, then
     restart the clock.
  */

  if (
    data.activeTask !==
      null &&
    data.activeStartTime
  ) {

    const index =
      data.activeTask;

    const elapsed =
      Math.max(
        0,
        Math.floor(
          (
            Date.now() -
            data.activeStartTime
          ) / 1000
        )
      );

    data.studySeconds[index] =
      Number(
        data.studySeconds[index] ||
          0
      ) + elapsed;

    data.activeStartTime =
      Date.now();
  }

  saveData();
}


window.addEventListener(
  "beforeunload",
  saveCurrentSessionSafely
);

window.addEventListener(
  "pagehide",
  saveCurrentSessionSafely
);


/* =========================================================
   EXPORT SHORTCUT
========================================================= */

window.addEventListener(
  "keydown",
  event => {

    if (
      event.ctrlKey &&
      event.shiftKey &&
      event.key.toLowerCase() ===
        "e"
    ) {

      event.preventDefault();

      exportBackup();
    }
  }
);


/* =========================================================
   FINAL DEBUG COMMANDS
========================================================= */

window.NEETOS.finalCheck =
  function() {

    return {
      app:
        "NEET OS",

      calendarDate:
        calendarDayKey(),

      studyDay:
        getStudyDayKey(),

      week:
        getWeekInfo().week,

      day:
        getWeekInfo().day,

      completedTasks:
        getCompletedTaskCount(),

      scheduledTasks:
        8,

      totalStudySeconds:
        getTotalStudySeconds(),

      totalQuestions:
        getTotalQuestions(),

      activeTask:
        data?.activeTask,

      selfStudySeconds:
        (() => {

          const index =
            tasks.findIndex(
              task =>
                task.type ===
                "self-study"
            );

          return index >= 0
            ? getTaskStudySeconds(
                index
              )
            : 0;
        })(),

      storage:
        window.NEETOSStorage
          ?.status?.()
    };
};


/* =========================================================
   FINAL SAFETY — KEEP SELF STUDY REPEATABLE
========================================================= */

setInterval(
  () => {

    if (!data) {
      return;
    }

    const selfStudyIndex =
      tasks.findIndex(
        task =>
          task.type ===
          "self-study"
      );

    if (
      selfStudyIndex >= 0 &&
      data.activeTask !==
        selfStudyIndex
    ) {

      /*
         Self Study must never
         become a permanently
         completed scheduled task.
      */

      if (
        data.completed[
          selfStudyIndex
        ]
      ) {

        delete data.completed[
          selfStudyIndex
        ];

        saveData();
      }
    }

  },
  5000
);


/* =========================================================
   CREATOR
========================================================= */

console.log(
  "NEET OS — Created by Dibyendu"
);


/* =========================================================
   END OF PART 4 / 4
========================================================= */
/* =========================================================
   FIX: SUBJECT-WISE CHAPTER LIST IN SESSION POPUP
   Physics → Physics
   Chemistry → Physical + Inorganic + Organic
   Biology → Botany + Zoology
========================================================= */

(function NEETOSSubjectChapterFix() {

  function getChaptersForTask(task) {
    if (!task) return [];

    if (task.subject === "Physics") {
      return SYLLABUS.Physics || [];
    }

    if (task.subject === "Chemistry") {
      return [
        ...(SYLLABUS["Physical Chemistry"] || []),
        ...(SYLLABUS["Inorganic Chemistry"] || []),
        ...(SYLLABUS["Organic Chemistry"] || [])
      ];
    }

    if (task.subject === "Biology") {
      return [
        ...(SYLLABUS.Botany || []),
        ...(SYLLABUS.Zoology || [])
      ];
    }

    return [];
  }


  function populateChapterSelectForTask(index) {

    const select = $("chapterSelect");

    if (!select) return;

    const task = tasks[index];

    if (!task) return;

    const chapters = getChaptersForTask(task);

    const previousChapter =
      data.taskMeta?.[index]?.chapter || "";

    /* Clear old Physics options */
    select.innerHTML = "";

    /* Default option */
    const defaultOption =
      document.createElement("option");

    defaultOption.value = "";
    defaultOption.textContent =
      "Select Chapter";

    select.appendChild(defaultOption);


    /* -----------------------------------------------------
       PHYSICS
    ----------------------------------------------------- */

    if (task.subject === "Physics") {

      chapters.forEach(
        (chapter, chapterIndex) => {

          const option =
            document.createElement("option");

          option.value = chapter;
          option.textContent =
            `${chapterIndex + 1}. ${chapter}`;

          select.appendChild(option);
        }
      );

    }


    /* -----------------------------------------------------
       CHEMISTRY
       Physical + Inorganic + Organic
    ----------------------------------------------------- */

    else if (task.subject === "Chemistry") {

      function addGroup(title, list) {

        if (!list || !list.length) return;

        const group =
          document.createElement("optgroup");

        group.label = title;

        list.forEach(
          (chapter, chapterIndex) => {

            const option =
              document.createElement("option");

            option.value = chapter;

            option.textContent =
              `${chapterIndex + 1}. ${chapter}`;

            group.appendChild(option);
          }
        );

        select.appendChild(group);
      }


      addGroup(
        "Physical Chemistry",
        SYLLABUS["Physical Chemistry"]
      );

      addGroup(
        "Inorganic Chemistry",
        SYLLABUS["Inorganic Chemistry"]
      );

      addGroup(
        "Organic Chemistry",
        SYLLABUS["Organic Chemistry"]
      );

    }


    /* -----------------------------------------------------
       BIOLOGY
       Botany + Zoology
    ----------------------------------------------------- */

    else if (task.subject === "Biology") {

      function addGroup(title, list) {

        if (!list || !list.length) return;

        const group =
          document.createElement("optgroup");

        group.label = title;

        list.forEach(
          (chapter, chapterIndex) => {

            const option =
              document.createElement("option");

            option.value = chapter;

            option.textContent =
              `${chapterIndex + 1}. ${chapter}`;

            group.appendChild(option);
          }
        );

        select.appendChild(group);
      }


      addGroup(
        "Botany",
        SYLLABUS.Botany
      );

      addGroup(
        "Zoology",
        SYLLABUS.Zoology
      );

    }


    /* Restore previously selected chapter */
    if (previousChapter) {
      select.value = previousChapter;
    }

  }


  /* -------------------------------------------------------
     Wrap existing openTaskModal()
     ------------------------------------------------------- */

  const originalOpenTaskModal =
    window.openTaskModal;

  if (
    typeof originalOpenTaskModal ===
    "function"
  ) {

    window.openTaskModal =
      function(index) {

        const result =
          originalOpenTaskModal(index);

        /*
           Existing modal opens first,
           then correct chapter list is loaded.
        */

        populateChapterSelectForTask(index);

        /*
           Re-apply previous chapter selection
        */
        const select =
          $("chapterSelect");

        const startButton =
          $("modalStartButton");

        if (select && startButton) {

          startButton.disabled =
            tasks[index]?.type === "class" &&
            !select.value;

        }

        return result;
      };

  }


  /* -------------------------------------------------------
     Debug message
  ------------------------------------------------------- */

  console.log(
    "NEET OS: Subject-wise chapter selection FIX loaded."
  );

})();
/* =========================================================
   NEET OS — LIVE CIRCULAR PROGRESS RING FIX
   Visual-only patch.
   
   Does NOT modify:
   - Firebase
   - Service Worker
   - Storage
   - Study timer
   - Task calculation
   - Progress calculation
   ========================================================= */

(function NEETOSCircularProgressFix() {

    function updateCircularProgressRing() {

        try {

            const percentElement =
                document.getElementById("progressPercent");

            if (!percentElement) {
                return;
            }

            const ring =
                document.querySelector(".progress-ring");

            if (!ring) {
                return;
            }


            /* ---------------------------------------------
               Read the already-calculated percentage
            --------------------------------------------- */

            const text =
                percentElement.textContent || "0%";

            const percentage =
                Math.max(
                    0,
                    Math.min(
                        100,
                        parseFloat(
                            text.replace("%", "")
                        ) || 0
                    )
                );


            /* ---------------------------------------------
               Update only the visual ring
            --------------------------------------------- */

            ring.style.background =
                `conic-gradient(
                    from -90deg,
                    #4da3ff 0%,
                    #4da3ff ${percentage}%,
                    rgba(255,255,255,0.10) ${percentage}%,
                    rgba(255,255,255,0.10) 100%
                )`;

        } catch (error) {

            console.warn(
                "NEET OS: Circular progress ring update failed.",
                error
            );

        }

    }


    /* Initial update */
    updateCircularProgressRing();


    /* Keep ring synchronized with percentage */
    setInterval(
        updateCircularProgressRing,
        1000
    );


    console.log(
        "NEET OS: Circular progress ring FIX loaded."
    );

})();
/* =========================================================
   NEET OS — STATS DATA DISPLAY FIX
   Daily Progress + 30-Day Performance

   APPEND-ONLY PATCH
   Does NOT modify:
   - Study timer
   - Task system
   - Storage
   - Firebase
   - Service Worker
   - Existing progress calculation
   - Existing statistics calculation
   ========================================================= */

(function NEETOSStatsDataFix() {

    function safeDuration(seconds) {

        try {

            if (typeof shortDuration === "function") {
                return shortDuration(
                    Number(seconds) || 0
                );
            }

            const total =
                Math.max(
                    0,
                    Math.floor(
                        Number(seconds) || 0
                    )
                );

            const hours =
                Math.floor(total / 3600);

            const minutes =
                Math.floor(
                    (total % 3600) / 60
                );

            return (
                hours +
                "h " +
                String(minutes).padStart(2, "0") +
                "m"
            );

        } catch (e) {

            return "0h 00m";

        }

    }


    function getTodayStats() {

        try {

            const studySeconds =
                typeof getTotalStudySeconds === "function"
                    ? Number(
                        getTotalStudySeconds() || 0
                    )
                    : 0;


            const questions =
                typeof getTotalQuestions === "function"
                    ? Number(
                        getTotalQuestions() || 0
                    )
                    : 0;


            let completed = 0;


            if (
                typeof getCompletedTaskCount ===
                "function"
            ) {

                completed =
                    Number(
                        getCompletedTaskCount() || 0
                    );

            } else if (
                typeof data !== "undefined" &&
                data
            ) {

                completed =
                    Object.values(
                        data.completed || {}
                    ).filter(Boolean).length;

            }


            const totalTasks = 8;


            const taskPercentage =
                totalTasks > 0
                    ? Math.round(
                        (
                            completed /
                            totalTasks
                        ) * 100
                    )
                    : 0;


            const questionPercentage =
                Math.min(
                    100,
                    Math.round(
                        (
                            questions /
                            180
                        ) * 100
                    )
                );


            const studyPercentage =
                Math.min(
                    100,
                    Math.round(
                        (
                            studySeconds /
                            (10 * 3600)
                        ) * 100
                    )
                );


            const consistency =
                Math.round(
                    taskPercentage * 0.4 +
                    questionPercentage * 0.3 +
                    studyPercentage * 0.3
                );


            return {

                studySeconds,
                questions,
                completed,
                totalTasks,
                taskPercentage,
                questionPercentage,
                studyPercentage,
                consistency

            };

        } catch (error) {

            console.warn(
                "NEET OS Stats: Could not read today's data.",
                error
            );

            return {

                studySeconds: 0,
                questions: 0,
                completed: 0,
                totalTasks: 8,
                taskPercentage: 0,
                questionPercentage: 0,
                studyPercentage: 0,
                consistency: 0

            };

        }

    }


    function get30DayStats() {

        try {

            let records = [];


            if (
                typeof getHistory === "function"
            ) {

                records =
                    getHistory() || [];

            }


            /*
               Add today's live snapshot.
               Existing history is NOT changed.
            */

            if (
                typeof createSnapshot ===
                    "function" &&
                typeof data !==
                    "undefined" &&
                data
            ) {

                const current =
                    createSnapshot(data);

                if (current) {

                    records.push(current);

                }

            }


            /*
               Keep only the latest record
               for each date.
            */

            const byDate = {};


            records.forEach(record => {

                if (
                    record &&
                    record.date
                ) {

                    byDate[
                        String(record.date)
                    ] = record;

                }

            });


            const days =
                Object.values(byDate)
                    .sort(
                        (a, b) =>
                            String(a.date)
                                .localeCompare(
                                    String(b.date)
                                )
                    )
                    .slice(-30);


            let totalStudy = 0;
            let totalQuestions = 0;
            let totalTasks = 0;


            days.forEach(record => {

                totalStudy +=
                    Number(
                        record.totalStudySeconds ||
                        0
                    );

                totalQuestions +=
                    Number(
                        record.totalQuestions ||
                        0
                    );

                totalTasks +=
                    Number(
                        record.completedCount ||
                        0
                    );

            });


            const averageStudy =
                days.length
                    ? totalStudy / days.length
                    : 0;


            const averageQuestions =
                days.length
                    ? totalQuestions / days.length
                    : 0;


            const averageTasks =
                days.length
                    ? totalTasks / days.length
                    : 0;


            const taskScore =
                Math.min(
                    100,
                    (
                        averageTasks /
                        8
                    ) * 100
                );


            const questionScore =
                Math.min(
                    100,
                    (
                        averageQuestions /
                        180
                    ) * 100
                );


            const studyScore =
                Math.min(
                    100,
                    (
                        averageStudy /
                        (10 * 3600)
                    ) * 100
                );


            const consistency =
                Math.round(
                    taskScore * 0.4 +
                    questionScore * 0.3 +
                    studyScore * 0.3
                );


            return {

                days,
                totalStudy,
                totalQuestions,
                totalTasks,
                averageStudy,
                averageQuestions,
                averageTasks,
                consistency

            };

        } catch (error) {

            console.warn(
                "NEET OS Stats: Could not read 30-day data.",
                error
            );

            return {

                days: [],
                totalStudy: 0,
                totalQuestions: 0,
                totalTasks: 0,
                averageStudy: 0,
                averageQuestions: 0,
                averageTasks: 0,
                consistency: 0

            };

        }

    }


    function addStatsStyles() {

        if (
            document.getElementById(
                "neetOSStatsDataFixStyle"
            )
        ) {
            return;
        }


        const style =
            document.createElement("style");


        style.id =
            "neetOSStatsDataFixStyle";


        style.textContent = `

            .neetos-live-stat {
                display: flex;
                justify-content: space-between;
                align-items: center;
                gap: 12px;
                padding: 12px 0;
                border-bottom: 1px solid rgba(255,255,255,.07);
            }

            .neetos-live-stat:last-child {
                border-bottom: 0;
            }

            .neetos-live-stat-label {
                opacity: .82;
            }

            .neetos-live-stat-value {
                font-weight: 700;
                white-space: nowrap;
            }

            .neetos-stat-progress {
                height: 7px;
                width: 100%;
                margin-top: 7px;
                border-radius: 999px;
                background: rgba(255,255,255,.08);
                overflow: hidden;
            }

            .neetos-stat-progress-fill {
                height: 100%;
                width: 0%;
                border-radius: 999px;
                background: linear-gradient(
                    90deg,
                    #35c8ff,
                    #4cffb0
                );
                transition: width .35s ease;
            }

            .neetos-30day-grid {
                display: grid;
                grid-template-columns:
                    repeat(2, minmax(0, 1fr));
                gap: 10px;
                margin-top: 12px;
            }

            .neetos-30day-box {
                padding: 13px;
                border-radius: 14px;
                background: rgba(255,255,255,.045);
                border: 1px solid rgba(255,255,255,.07);
            }

            .neetos-30day-box small {
                display: block;
                opacity: .68;
                margin-bottom: 5px;
            }

            .neetos-30day-box strong {
                font-size: 17px;
            }

            .neetos-consistency {
                margin-top: 14px;
                padding: 13px;
                border-radius: 14px;
                background: rgba(255,255,255,.045);
            }

            .neetos-consistency-head {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 7px;
            }

            @media (max-width: 420px) {

                .neetos-30day-grid {
                    grid-template-columns: 1fr;
                }

            }

        `;


        document.head.appendChild(style);

    }


    function updateDailyProgressCard() {

        const statsSection =
            document.getElementById(
                "statsSection"
            );


        if (!statsSection) {
            return;
        }


        const cards =
            statsSection.querySelectorAll(
                ".simple-card"
            );


        let dailyCard = null;


        cards.forEach(card => {

            const heading =
                card.querySelector("h3");


            if (
                heading &&
                heading.textContent
                    .trim()
                    .toLowerCase() ===
                "daily progress"
            ) {

                dailyCard = card;

            }

        });


        if (!dailyCard) {
            return;
        }


        const s =
            getTodayStats();


        dailyCard.innerHTML = `

            <h3>Daily Progress</h3>

            <div class="neetos-live-stat">

                <div>
                    <div class="neetos-live-stat-label">
                        Study Time
                    </div>

                    <div class="neetos-stat-progress">
                        <div
                            class="neetos-stat-progress-fill"
                            style="width:${s.studyPercentage}%"
                        ></div>
                    </div>
                </div>

                <strong class="neetos-live-stat-value">
                    ${safeDuration(
                        s.studySeconds
                    )}
                </strong>

            </div>


            <div class="neetos-live-stat">

                <span class="neetos-live-stat-label">
                    Tasks Completed
                </span>

                <strong class="neetos-live-stat-value">
                    ${s.completed} / ${s.totalTasks}
                </strong>

            </div>


            <div class="neetos-live-stat">

                <span class="neetos-live-stat-label">
                    Questions Solved
                </span>

                <strong class="neetos-live-stat-value">
                    ${s.questions}
                </strong>

            </div>


            <div class="neetos-live-stat">

                <span class="neetos-live-stat-label">
                    Daily Consistency
                </span>

                <strong class="neetos-live-stat-value">
                    ${s.consistency}%
                </strong>

            </div>

        `;

    }


    function update30DayPerformance() {

        const statsSection =
            document.getElementById(
                "statsSection"
            );


        if (!statsSection) {
            return;
        }


        let card =
            document.getElementById(
                "neetOS30DayPerformance"
            );


        if (!card) {

            card =
                document.createElement(
                    "div"
                );

            card.id =
                "neetOS30DayPerformance";

            card.className =
                "simple-card";


            statsSection.appendChild(
                card
            );

        }


        const s =
            get30DayStats();


        card.innerHTML = `

            <h3>30-Day Performance</h3>

            <p style="
                margin-top:6px;
                opacity:.72;
            ">
                Your recent study performance
                based on saved daily records.
            </p>


            <div class="neetos-30day-grid">

                <div class="neetos-30day-box">

                    <small>
                        Days Recorded
                    </small>

                    <strong>
                        ${s.days.length} / 30
                    </strong>

                </div>


                <div class="neetos-30day-box">

                    <small>
                        Total Study
                    </small>

                    <strong>
                        ${safeDuration(
                            s.totalStudy
                        )}
                    </strong>

                </div>


                <div class="neetos-30day-box">

                    <small>
                        Average / Day
                    </small>

                    <strong>
                        ${safeDuration(
                            s.averageStudy
                        )}
                    </strong>

                </div>


                <div class="neetos-30day-box">

                    <small>
                        Total Questions
                    </small>

                    <strong>
                        ${s.totalQuestions}
                    </strong>

                </div>


                <div class="neetos-30day-box">

                    <small>
                        Average Questions / Day
                    </small>

                    <strong>
                        ${Math.round(
                            s.averageQuestions
                        )}
                    </strong>

                </div>


                <div class="neetos-30day-box">

                    <small>
                        Tasks Completed
                    </small>

                    <strong>
                        ${s.totalTasks}
                    </strong>

                </div>

            </div>


            <div class="neetos-consistency">

                <div class="neetos-consistency-head">

                    <span>
                        Consistency
                    </span>

                    <strong>
                        ${s.consistency}%
                    </strong>

                </div>


                <div class="neetos-stat-progress">

                    <div
                        class="neetos-stat-progress-fill"
                        style="
                            width:${s.consistency}%
                        "
                    ></div>

                </div>

            </div>

        `;

    }


    function refreshStatsData() {

        try {

            addStatsStyles();

            updateDailyProgressCard();

            update30DayPerformance();

        } catch (error) {

            console.warn(
                "NEET OS Stats Data Fix error:",
                error
            );

        }

    }


    function initializeStatsFix() {

        refreshStatsData();


        /*
           Keep the displayed data live.
        */

        setInterval(
            refreshStatsData,
            1000
        );


        console.log(
            "NEET OS: Daily Progress + 30-Day Performance FIX loaded."
        );

    }


    if (
        document.readyState ===
        "loading"
    ) {

        document.addEventListener(
            "DOMContentLoaded",
            initializeStatsFix
        );

    } else {

        initializeStatsFix();

    }

})();
/* =========================================================
   NEET OS — FINAL STATS STABILIZER
   APPEND ONLY — DO NOT DELETE EXISTING CODE

   FIXES:
   1. Subject Breakdown actual study time
   2. Daily Progress — 4 live progress bars
   3. No screen/card blinking
   4. Remove duplicate empty 30-Day Performance
   5. Keep real 30-Day Performance data
   6. No Firebase / SW / storage / timer changes
   ========================================================= */

(function NEETOSFinalStatsStabilizer() {

    "use strict";


    /* =====================================================
       HELPERS
       ===================================================== */

    function statsSection() {
        return document.getElementById("statsSection");
    }


    function formatTime(seconds) {

        const total = Math.max(
            0,
            Math.floor(Number(seconds) || 0)
        );

        const h = Math.floor(
            total / 3600
        );

        const m = Math.floor(
            (total % 3600) / 60
        );

        return `${h}h ${String(m).padStart(2, "0")}m`;
    }


    function getCards() {

        const stats = statsSection();

        if (!stats) return [];

        return [
            ...stats.querySelectorAll(
                ".simple-card"
            )
        ];
    }


    function getCard(title) {

        return getCards().find(card => {

            const h =
                card.querySelector("h3");

            return h &&
                h.textContent
                    .trim()
                    .toLowerCase() ===
                title.toLowerCase();

        }) || null;
    }


    /* =====================================================
       IMPORTANT:
       PREVENT OLD STATS PATCHES FROM REBUILDING
       OUR STATS CARDS EVERY SECOND.

       Only stats cards are protected.
       Other NEET OS elements remain untouched.
       ===================================================== */

    const protectedCards =
        new WeakSet();


    const originalInnerHTML =
        Object.getOwnPropertyDescriptor(
            Element.prototype,
            "innerHTML"
        );


    if (
        originalInnerHTML &&
        originalInnerHTML.get &&
        originalInnerHTML.set
    ) {

        Object.defineProperty(
            Element.prototype,
            "innerHTML",
            {

                configurable:
                    originalInnerHTML.configurable,

                enumerable:
                    originalInnerHTML.enumerable,

                get:
                    originalInnerHTML.get,

                set: function(value) {

                    /*
                       If this element belongs to
                       our protected Stats cards,
                       ignore old patch redraws.
                    */

                    if (
                        protectedCards.has(this)
                    ) {
                        return;
                    }

                    return originalInnerHTML.set
                        .call(this, value);

                }

            }
        );

    }


    /* =====================================================
       SUBJECT BREAKDOWN
       ===================================================== */

    function fixSubjectBreakdown() {

        const card =
            getCard("Subject Breakdown");

        if (!card) return;


        const subjects = [
            "Physics",
            "Chemistry",
            "Biology"
        ];


        /*
           Find existing rows.
        */

        let rows =
            [
                ...card.querySelectorAll(
                    ".stat-row-page"
                )
            ];


        /*
           If the old structure exists,
           update it directly.
        */

        if (rows.length >= 3) {

            subjects.forEach(
                (subject, index) => {

                    const row =
                        rows[index];

                    if (!row) return;


                    let seconds = 0;


                    /*
                       Directly calculate from
                       existing NEET OS data.
                    */

                    try {

                        if (
                            typeof data !==
                            "undefined" &&
                            data &&
                            Array.isArray(
                                data.studySeconds
                            ) &&
                            typeof tasks !==
                            "undefined"
                        ) {

                            tasks.forEach(
                                (
                                    task,
                                    taskIndex
                                ) => {

                                    if (
                                        task &&
                                        task.subject ===
                                        subject
                                    ) {

                                        seconds +=
                                            Number(
                                                data.studySeconds[
                                                    taskIndex
                                                ] || 0
                                            );

                                    }

                                }
                            );

                        }

                    } catch (e) {
                        console.warn(
                            "Subject stats read error:",
                            e
                        );
                    }


                    const value =
                        row.querySelector(
                            "strong"
                        );


                    if (!value) return;


                    const text =
                        formatTime(seconds);


                    if (
                        value.textContent !==
                        text
                    ) {

                        value.textContent =
                            text;

                    }

                }
            );


            return;
        }


        /*
           Fallback:
           if rows are missing, create them
           ONCE and then protect the card.
        */

        const heading =
            card.querySelector("h3");


        if (!heading) return;


        card.innerHTML = `
            <h3>Subject Breakdown</h3>

            <div class="stat-row-page">
                <span>Physics</span>
                <strong>0h 00m</strong>
            </div>

            <div class="stat-row-page">
                <span>Chemistry</span>
                <strong>0h 00m</strong>
            </div>

            <div class="stat-row-page">
                <span>Biology</span>
                <strong>0h 00m</strong>
            </div>
        `;


        protectedCards.add(card);


        /*
           Run once again after structure creation.
        */

        fixSubjectBreakdown();

    }


    /* =====================================================
       DAILY PROGRESS — BUILD ONLY ONCE
       ===================================================== */

    function getDailyCard() {

        let card =
            document.getElementById(
                "neetOSFinalDailyProgress"
            );


        if (card) return card;


        card =
            getCard("Daily Progress");


        if (!card) return null;


        card.id =
            "neetOSFinalDailyProgress";


        /*
           Build correct structure ONE TIME.
        */

        card.innerHTML = `

            <h3>Daily Progress</h3>

            <div
                class="neetos-final-progress-row"
                data-final-row="study"
            >

                <div
                    class="neetos-final-progress-main"
                >

                    <span>
                        Study Time
                    </span>

                    <div
                        class="neetos-final-progress-track"
                    >
                        <div
                            data-final-bar="study"
                        ></div>
                    </div>

                </div>

                <strong
                    data-final-value="study"
                >
                    0h 00m
                </strong>

            </div>


            <div
                class="neetos-final-progress-row"
                data-final-row="tasks"
            >

                <div
                    class="neetos-final-progress-main"
                >

                    <span>
                        Tasks Completed
                    </span>

                    <div
                        class="neetos-final-progress-track"
                    >
                        <div
                            data-final-bar="tasks"
                        ></div>
                    </div>

                </div>

                <strong
                    data-final-value="tasks"
                >
                    0 / 8
                </strong>

            </div>


            <div
                class="neetos-final-progress-row"
                data-final-row="questions"
            >

                <div
                    class="neetos-final-progress-main"
                >

                    <span>
                        Questions Solved
                    </span>

                    <div
                        class="neetos-final-progress-track"
                    >
                        <div
                            data-final-bar="questions"
                        ></div>
                    </div>

                </div>

                <strong
                    data-final-value="questions"
                >
                    0
                </strong>

            </div>


            <div
                class="neetos-final-progress-row"
                data-final-row="consistency"
            >

                <div
                    class="neetos-final-progress-main"
                >

                    <span>
                        Daily Consistency
                    </span>

                    <div
                        class="neetos-final-progress-track"
                    >
                        <div
                            data-final-bar="consistency"
                        ></div>
                    </div>

                </div>

                <strong
                    data-final-value="consistency"
                >
                    0%
                </strong>

            </div>

        `;


        protectedCards.add(card);


        return card;

    }


    /* =====================================================
       DAILY DATA
       ===================================================== */

    function updateDailyProgress() {

        const card =
            getDailyCard();

        if (!card) return;


        let studySeconds = 0;
        let questions = 0;
        let completed = 0;


        try {

            if (
                typeof getTodayStats ===
                "function"
            ) {

                const today =
                    getTodayStats();


                if (today) {

                    studySeconds =
                        Number(
                            today.studySeconds ||
                            0
                        );


                    questions =
                        Number(
                            today.questions ||
                            0
                        );


                    completed =
                        Number(
                            today.completed ||
                            0
                        );

                }

            }

        } catch (e) {

            console.warn(
                "Daily stats read error:",
                e
            );

        }


        /*
           Fallback to existing core data.
        */

        try {

            if (
                studySeconds === 0 &&
                typeof getTotalStudySeconds ===
                "function"
            ) {

                studySeconds =
                    Number(
                        getTotalStudySeconds() ||
                        0
                    );

            }


            if (
                questions === 0 &&
                typeof getTotalQuestions ===
                "function"
            ) {

                questions =
                    Number(
                        getTotalQuestions() ||
                        0
                    );

            }


            if (
                completed === 0 &&
                typeof getCompletedTaskCount ===
                "function"
            ) {

                completed =
                    Number(
                        getCompletedTaskCount() ||
                        0
                    );

            }

        } catch (e) {}


        const totalTasks = 8;


        /*
           Same progress basis used by the
           existing NEET OS Stats calculation.
        */

        const studyPercent =
            Math.max(
                0,
                Math.min(
                    100,
                    Math.round(
                        (
                            studySeconds /
                            (10 * 3600)
                        ) * 100
                    )
                )
            );


        const taskPercent =
            Math.max(
                0,
                Math.min(
                    100,
                    Math.round(
                        (
                            completed /
                            totalTasks
                        ) * 100
                    )
                )
            );


        const questionPercent =
            Math.max(
                0,
                Math.min(
                    100,
                    Math.round(
                        (
                            questions /
                            180
                        ) * 100
                    )
                )
            );


        const consistency =
            Math.max(
                0,
                Math.min(
                    100,
                    Math.round(
                        studyPercent * 0.30 +
                        taskPercent * 0.40 +
                        questionPercent * 0.30
                    )
                )
            );


        const values = {

            study:
                formatTime(
                    studySeconds
                ),

            tasks:
                `${completed} / ${totalTasks}`,

            questions:
                String(questions),

            consistency:
                `${consistency}%`

        };


        const percentages = {

            study:
                studyPercent,

            tasks:
                taskPercent,

            questions:
                questionPercent,

            consistency:
                consistency

        };


        /*
           UPDATE ONLY TEXT
           No redraw.
        */

        Object.keys(values).forEach(
            type => {

                const element =
                    card.querySelector(
                        `[data-final-value="${type}"]`
                    );


                if (
                    element &&
                    element.textContent !==
                    values[type]
                ) {

                    element.textContent =
                        values[type];

                }

            }
        );


        /*
           UPDATE ONLY BAR WIDTH.
        */

        Object.keys(percentages).forEach(
            type => {

                const bar =
                    card.querySelector(
                        `[data-final-bar="${type}"]`
                    );


                if (!bar) return;


                const width =
                    percentages[type] + "%";


                if (
                    bar.style.width !==
                    width
                ) {

                    bar.style.width =
                        width;

                }

            }
        );

    }


    /* =====================================================
       REMOVE DUPLICATE EMPTY 30-DAY CARD
       ===================================================== */

    function removeOld30DayCard() {

        const stats =
            statsSection();

        if (!stats) return;


        const cards =
            [
                ...stats.querySelectorAll(
                    ".simple-card"
                )
            ];


        cards.forEach(card => {

            const heading =
                card.querySelector("h3");


            if (!heading) return;


            const title =
                heading.textContent
                    .trim()
                    .toLowerCase();


            if (
                title !==
                "30-day performance"
            ) {
                return;
            }


            const text =
                card.textContent
                    .replace(/\s+/g, " ")
                    .trim();


            /*
               Hide/remove ONLY the empty
               original placeholder.
            */

            if (
                text.includes(
                    "Your 30-day study consistency and progress report will appear here"
                )
            ) {

                card.remove();

            }

        });

    }


    /* =====================================================
       30-DAY PERFORMANCE
       KEEP REAL DATA CARD
       ===================================================== */

    function update30DayCard() {

        const stats =
            statsSection();

        if (!stats) return;


        const cards =
            [
                ...stats.querySelectorAll(
                    ".simple-card"
                )
            ];


        const realCards =
            cards.filter(card => {

                const h =
                    card.querySelector("h3");


                if (!h) return false;


                if (
                    h.textContent
                        .trim()
                        .toLowerCase() !==
                    "30-day performance"
                ) {
                    return false;
                }


                const text =
                    card.textContent
                        .replace(/\s+/g, " ")
                        .trim();


                return !text.includes(
                    "Your 30-day study consistency and progress report will appear here"
                );

            });


        if (
            realCards.length === 0
        ) {
            return;
        }


        /*
           If multiple real cards somehow exist,
           keep the last one visible.
        */

        const card =
            realCards[
                realCards.length - 1
            ];


        realCards.forEach(
            other => {

                if (
                    other !== card
                ) {

                    other.style.display =
                        "none";

                }

            }
        );


        card.id =
            "neetOSFinal30DayPerformance";


        /*
           Protect from old interval's
           innerHTML redraw.
        */

        protectedCards.add(card);


        /*
           Use existing calculated 30-day data.
        */

        let s = null;


        try {

            if (
                typeof get30DayStats ===
                "function"
            ) {

                s =
                    get30DayStats();

            }

        } catch (e) {

            console.warn(
                "30-day stats read error:",
                e
            );

        }


        if (!s) return;


        const strongs =
            card.querySelectorAll(
                ".neetos-30day-box strong"
            );


        if (
            strongs.length >= 6
        ) {

            const values = [

                `${s.days.length} / 30`,

                formatTime(
                    s.totalStudy
                ),

                formatTime(
                    s.averageStudy
                ),

                String(
                    s.totalQuestions
                ),

                String(
                    Math.round(
                        s.averageQuestions
                    )
                ),

                String(
                    s.totalTasks
                )

            ];


            values.forEach(
                (value, index) => {

                    if (
                        strongs[index] &&
                        strongs[index]
                            .textContent !==
                        value
                    ) {

                        strongs[index]
                            .textContent =
                            value;

                    }

                }
            );

        }


        const consistency =
            card.querySelector(
                ".neetos-consistency strong"
            );


        if (consistency) {

            const value =
                `${s.consistency}%`;


            if (
                consistency.textContent !==
                value
            ) {

                consistency.textContent =
                    value;

            }

        }


        const consistencyBar =
            card.querySelector(
                ".neetos-stat-progress-fill"
            );


        if (consistencyBar) {

            const width =
                `${Math.max(
                    0,
                    Math.min(
                        100,
                        Number(
                            s.consistency
                        ) || 0
                    )
                )}%`;


            if (
                consistencyBar.style.width !==
                width
            ) {

                consistencyBar.style.width =
                    width;

            }

        }

    }


    /* =====================================================
       STYLES — ONLY ONCE
       ===================================================== */

    function addFinalStyles() {

        if (
            document.getElementById(
                "neetOSFinalStatsStyle"
            )
        ) {
            return;
        }


        const style =
            document.createElement(
                "style"
            );


        style.id =
            "neetOSFinalStatsStyle";


        style.textContent = `

            .neetos-final-progress-row {
                display: flex;
                align-items: center;
                gap: 18px;
                padding: 14px 0;
            }

            .neetos-final-progress-main {
                flex: 1;
                min-width: 0;
            }

            .neetos-final-progress-main > span {
                display: block;
                margin-bottom: 8px;
            }

            .neetos-final-progress-track {
                width: 100%;
                height: 7px;
                border-radius: 999px;
                overflow: hidden;
                background: rgba(255,255,255,.10);
            }

            .neetos-final-progress-track > div {
                width: 0%;
                height: 100%;
                border-radius: 999px;
                background: linear-gradient(
                    90deg,
                    #32d6d0,
                    #59a7ff
                );
                transition: width .25s ease;
            }

            .neetos-final-progress-row strong {
                min-width: 72px;
                text-align: right;
                white-space: nowrap;
            }

        `;


        document.head.appendChild(
            style
        );

    }


    /* =====================================================
       MAIN REFRESH
       ===================================================== */

    function finalRefresh() {

        try {

            addFinalStyles();

            removeOld30DayCard();

            fixSubjectBreakdown();

            updateDailyProgress();

            update30DayCard();

        } catch (error) {

            console.warn(
                "NEET OS Final Stats Stabilizer:",
                error
            );

        }

    }


    /* =====================================================
       FIRST RUN
       ===================================================== */

    finalRefresh();


    /* =====================================================
       LIVE UPDATE

       Only values/bar widths update.
       Cards are NOT rebuilt.
       ===================================================== */

    setInterval(
        finalRefresh,
        1000
    );


    /* =====================================================
       HANDLE STATS PAGE NAVIGATION

       If the app recreates the Stats page,
       restore our final UI.
       ===================================================== */

    let refreshQueued = false;


    const observer =
        new MutationObserver(
            () => {

                if (refreshQueued) {
                    return;
                }


                refreshQueued = true;


                requestAnimationFrame(
                    () => {

                        refreshQueued =
                            false;

                        finalRefresh();

                    }
                );

            }
        );


    const appRoot =
        document.body;


    if (appRoot) {

        observer.observe(
            appRoot,
            {
                childList: true,
                subtree: true
            }
        );

    }


    console.log(
        "NEET OS: FINAL Stats Stabilizer loaded — no blink."
    );


})();
/* =========================================================
   NEET OS — DAILY REPAIR + SELF STUDY ADVANCED ADD-ON
   ---------------------------------------------------------
   ADD-ONLY PATCH
   Does NOT modify index.html
   Does NOT modify style.css
   Does NOT modify service-worker.js
   Does NOT modify Firebase code
   ========================================================= */

(function NEETOSRepairSelfStudyAddon() {

    "use strict";

    const REPAIR_INDEX = tasks.findIndex(
        t => t && t.type === "repair"
    );

    const SELF_STUDY_INDEX = tasks.findIndex(
        t => t && t.type === "self-study"
    );

    const ADDON_VERSION = "1.0.0";

    let addonBusy = false;


    /* =====================================================
       SUBJECT → CHAPTER LIST
       Uses existing NEET OS SYLLABUS
       ===================================================== */

    function getAddonChapters(subject) {

        if (typeof SYLLABUS === "undefined") {
            return [];
        }

        if (subject === "Physics") {
            return SYLLABUS.Physics || [];
        }

        if (subject === "Chemistry") {
            return [
                ...(SYLLABUS["Physical Chemistry"] || []),
                ...(SYLLABUS["Inorganic Chemistry"] || []),
                ...(SYLLABUS["Organic Chemistry"] || [])
            ];
        }

        if (subject === "Botany") {
            return SYLLABUS.Botany || [];
        }

        if (subject === "Zoology") {
            return SYLLABUS.Zoology || [];
        }

        return [];
    }


    /* =====================================================
       REMOVE OLD ADDON POPUP
       ===================================================== */

    function removeAddonPopup() {

        const old =
            document.getElementById(
                "neetosAddonPopup"
            );

        if (old) {
            old.remove();
        }

        addonBusy = false;
    }


    /* =====================================================
       COMMON POPUP CREATOR
       ===================================================== */

    function createAddonPopup(title, subtitle) {

        removeAddonPopup();

        addonBusy = true;

        const overlay =
            document.createElement("div");

        overlay.id =
            "neetosAddonPopup";

        overlay.style.cssText = `
            position:fixed;
            inset:0;
            z-index:999999;
            background:rgba(0,0,0,.78);
            display:flex;
            align-items:center;
            justify-content:center;
            padding:18px;
            box-sizing:border-box;
        `;

        const box =
            document.createElement("div");

        box.style.cssText = `
            width:min(520px,94vw);
            max-height:90vh;
            overflow:auto;
            background:#10253d;
            border:1px solid rgba(100,210,255,.35);
            border-radius:22px;
            padding:22px;
            box-sizing:border-box;
            box-shadow:0 20px 70px rgba(0,0,0,.55);
            color:#fff;
            font-family:Arial,sans-serif;
        `;

        const heading =
            document.createElement("div");

        heading.textContent = title;

        heading.style.cssText = `
            font-size:24px;
            font-weight:800;
            margin-bottom:8px;
        `;

        const desc =
            document.createElement("div");

        desc.textContent =
            subtitle || "";

        desc.style.cssText = `
            font-size:14px;
            color:#b8c9da;
            margin-bottom:20px;
            line-height:1.5;
        `;

        box.appendChild(heading);
        box.appendChild(desc);

        overlay.appendChild(box);

        document.body.appendChild(overlay);

        return {
            overlay,
            box
        };
    }


    /* =====================================================
       BUTTON CREATOR
       ===================================================== */

    function makeAddonButton(text, onClick) {

        const button =
            document.createElement("button");

        button.type = "button";

        button.textContent = text;

        button.style.cssText = `
            width:100%;
            padding:15px 16px;
            margin:7px 0;
            border-radius:14px;
            border:1px solid rgba(120,220,255,.28);
            background:#163451;
            color:#fff;
            font-size:16px;
            font-weight:700;
            text-align:left;
            cursor:pointer;
            transition:.15s;
        `;

        button.addEventListener(
            "mouseenter",
            () => {
                button.style.background =
                    "#1d4568";
            }
        );

        button.addEventListener(
            "mouseleave",
            () => {
                button.style.background =
                    "#163451";
            }
        );

        button.addEventListener(
            "click",
            event => {
                event.preventDefault();
                event.stopPropagation();
                onClick();
            }
        );

        return button;
    }


    /* =====================================================
       CANCEL BUTTON
       ===================================================== */

    function makeCancelButton() {

        const button =
            document.createElement("button");

        button.type = "button";

        button.textContent = "Cancel";

        button.style.cssText = `
            width:100%;
            padding:12px;
            margin-top:12px;
            border-radius:12px;
            border:1px solid rgba(255,255,255,.15);
            background:transparent;
            color:#aebfd0;
            font-size:14px;
            cursor:pointer;
        `;

        button.onclick =
            () => removeAddonPopup();

        return button;
    }


    /* =====================================================
       STEP 1
       FOUR ACTIVITY OPTIONS
       ===================================================== */

    function openActivityPopup(index) {

        const task = tasks[index];

        const popup =
            createAddonPopup(
                task.name,
                "What do you want to work on during this session?"
            );

        const options = [
            {
                key: "Doubt/Error Analysis",
                icon: "🧠"
            },
            {
                key: "Question Practice",
                icon: "📝"
            },
            {
                key: "Backlog Clear",
                icon: "📚"
            },
            {
                key: "Revision",
                icon: "🔄"
            }
        ];

        options.forEach(option => {

            const button =
                makeAddonButton(
                    `${option.icon}  ${option.key}`,
                    () => {

                        openSubjectPopup(
                            index,
                            option.key
                        );

                    }
                );

            popup.box.appendChild(button);

        });

        popup.box.appendChild(
            makeCancelButton()
        );
    }


    /* =====================================================
       STEP 2
       SUBJECT SELECTION
       ===================================================== */

    function openSubjectPopup(index, activity) {

        const popup =
            createAddonPopup(
                activity,
                "Select the subject for this session."
            );

        const subjects = [
            "Physics",
            "Chemistry",
            "Botany",
            "Zoology"
        ];

        subjects.forEach(subject => {

            const button =
                makeAddonButton(
                    subject,
                    () => {

                        openChapterPopup(
                            index,
                            activity,
                            subject
                        );

                    }
                );

            popup.box.appendChild(button);

        });

        popup.box.appendChild(
            makeCancelButton()
        );
    }


    /* =====================================================
       STEP 3
       CHAPTER SELECTION
       ===================================================== */

    function openChapterPopup(
        index,
        activity,
        subject
    ) {

        const chapters =
            getAddonChapters(subject);

        const popup =
            createAddonPopup(
                subject,
                "Select the chapter."
            );

        if (!chapters.length) {

            const warning =
                document.createElement("div");

            warning.textContent =
                "No chapter list found for this subject.";

            warning.style.cssText = `
                color:#ffb5b5;
                padding:12px 0;
            `;

            popup.box.appendChild(warning);

            popup.box.appendChild(
                makeCancelButton()
            );

            return;
        }


        const select =
            document.createElement("select");

        select.style.cssText = `
            width:100%;
            padding:14px;
            border-radius:12px;
            border:1px solid rgba(120,220,255,.3);
            background:#0d1e31;
            color:#fff;
            font-size:15px;
            box-sizing:border-box;
            margin-bottom:14px;
        `;

        const defaultOption =
            document.createElement("option");

        defaultOption.value = "";
        defaultOption.textContent =
            "Select Chapter";

        select.appendChild(
            defaultOption
        );


        chapters.forEach(chapter => {

            const option =
                document.createElement("option");

            option.value = chapter;
            option.textContent = chapter;

            select.appendChild(option);

        });


        popup.box.appendChild(select);


        const startButton =
            document.createElement("button");

        startButton.type = "button";

        startButton.textContent =
            "▶ Start Session";

        startButton.disabled = true;

        startButton.style.cssText = `
            width:100%;
            padding:15px;
            border-radius:13px;
            border:0;
            background:#1678a8;
            color:#fff;
            font-size:16px;
            font-weight:800;
            cursor:pointer;
            opacity:.45;
        `;


        select.addEventListener(
            "change",
            () => {

                startButton.disabled =
                    !select.value;

                startButton.style.opacity =
                    select.value ? "1" : ".45";

            }
        );


        startButton.addEventListener(
            "click",
            event => {

                event.preventDefault();
                event.stopPropagation();

                if (!select.value) {
                    return;
                }

                beginAddonSession(
                    index,
                    activity,
                    subject,
                    select.value
                );

            }
        );


        popup.box.appendChild(
            startButton
        );


        popup.box.appendChild(
            makeCancelButton()
        );
    }


    /* =====================================================
       START ADDON SESSION
       ===================================================== */

    function beginAddonSession(
        index,
        activity,
        subject,
        chapter
    ) {

        if (!data) {
            removeAddonPopup();

            alert(
                "NEET OS data is not ready yet."
            );

            return;
        }


        if (
            data.activeTask !== null &&
            data.activeTask !== index
        ) {

            removeAddonPopup();

            alert(
                "Another study task is already running."
            );

            return;
        }


        /* Save session information */

        data.taskMeta =
            data.taskMeta || {};


        data.taskMeta[index] = {
            ...(data.taskMeta[index] || {}),

            addonVersion:
                ADDON_VERSION,

            addonActivity:
                activity,

            addonSubject:
                subject,

            addonChapter:
                chapter,

            addonStartedAt:
                Date.now()
        };


        /*
           Self Study is repeatable.
           Therefore never leave it permanently
           marked as completed.
        */

        if (index === SELF_STUDY_INDEX) {
            data.completed[index] = false;
        }


        removeAddonPopup();


        /*
           Use the existing NEET OS start engine.
           This preserves the existing timer/storage logic.
        */

        actuallyStartTask(index);


        console.log(
            "NEET OS Add-on session started:",
            {
                index,
                activity,
                subject,
                chapter
            }
        );
    }


    /* =====================================================
       STOP ADDON SESSION
       ===================================================== */

    function stopAddonSession(index) {

        if (
            !data ||
            data.activeTask !== index
        ) {
            return;
        }


        const started =
            Number(
                data.activeStartTime || 0
            );


        const elapsed =
            started
                ? Math.max(
                    0,
                    Math.floor(
                        (Date.now() - started) /
                        1000
                    )
                )
                : 0;


        /*
           Add study time
        */

        data.studySeconds =
            data.studySeconds || {};

        data.studySeconds[index] =
            Number(
                data.studySeconds[index] || 0
            ) + elapsed;


        const meta =
            data.taskMeta?.[index] || {};


        let questions = 0;


        /*
           QUESTION PRACTICE
           Ask actual question count at STOP
        */

        if (
            meta.addonActivity ===
            "Question Practice"
        ) {

            const answer =
                prompt(
                    "How many questions did you practice?\n\n" +
                    `${meta.addonSubject} — ${meta.addonChapter}`,
                    "0"
                );


            questions =
                Math.max(
                    0,
                    Number.parseInt(
                        answer || "0",
                        10
                    ) || 0
                );


            data.questionCounts =
                data.questionCounts || {};


            /*
               Accumulate questions.
               This is important for repeatable
               Self Study sessions.
            */

            data.questionCounts[index] =
                Number(
                    data.questionCounts[index] || 0
                ) + questions;
        }


        /*
           Save detailed session history
           without touching existing structures.
        */

        if (
            !Array.isArray(
                data.addonSessions
            )
        ) {
            data.addonSessions = [];
        }


        data.addonSessions.push({

            date:
                getStudyDayKey(),

            taskIndex:
                index,

            taskName:
                tasks[index]?.name ||
                "Unknown",

            activity:
                meta.addonActivity ||
                "Unknown",

            subject:
                meta.addonSubject ||
                "",

            chapter:
                meta.addonChapter ||
                "",

            seconds:
                elapsed,

            questions:
                questions,

            startedAt:
                started,

            stoppedAt:
                Date.now()
        });


        /*
           Stop timer
        */

        data.activeTask =
            null;

        data.activeStartTime =
            null;


        /*
           Daily Repair = normal scheduled task
           → completed after stopping.
        */

        if (
            index === REPAIR_INDEX
        ) {
            data.completed[index] =
                true;
        }


        /*
           Self Study = repeatable
           → NEVER permanently completed.
        */

        if (
            index === SELF_STUDY_INDEX
        ) {
            data.completed[index] =
                false;
        }


        saveData();


        /*
           Existing UI update functions
        */

        renderTasks();

        updateProgress();

        updateStats();


        console.log(
            "NEET OS Add-on session stopped:",
            {
                index,
                activity:
                    meta.addonActivity,
                subject:
                    meta.addonSubject,
                chapter:
                    meta.addonChapter,
                seconds:
                    elapsed,
                questions:
                    questions
            }
        );
    }


    /* =====================================================
       BUTTON INTERCEPTOR
       -----------------------------------------------------
       Captures Repair/Self Study buttons BEFORE
       the existing click handler.

       Existing app.js code remains untouched.
       ===================================================== */

    function installButtonInterceptor() {

        document.addEventListener(
            "click",
            event => {

                const button =
                    event.target.closest(
                        ".start-button"
                    );

                if (!button) {
                    return;
                }


                const buttons =
                    Array.from(
                        document.querySelectorAll(
                            ".start-button"
                        )
                    );


                const index =
                    buttons.indexOf(button);


                if (
                    index !== REPAIR_INDEX &&
                    index !== SELF_STUDY_INDEX
                ) {
                    return;
                }


                /*
                   Stop existing event handler
                   so the original generic popup
                   does not appear.
                */

                event.preventDefault();

                event.stopPropagation();

                event.stopImmediatePropagation();


                if (addonBusy) {
                    return;
                }


                /*
                   ACTIVE → STOP
                */

                if (
                    data &&
                    data.activeTask === index
                ) {

                    stopAddonSession(index);

                    return;
                }


                /*
                   Another task already active
                */

                if (
                    data &&
                    data.activeTask !== null &&
                    data.activeTask !== index
                ) {

                    alert(
                        "Another study task is already running."
                    );

                    return;
                }


                /*
                   Daily Repair must obey
                   its scheduled window.
                */

                if (
                    index === REPAIR_INDEX &&
                    !isTaskInWindow(
                        tasks[index]
                    )
                ) {

                    alert(
                        `This task can only be started during its scheduled time.\n\n` +
                        `${tasks[index].name}\n` +
                        `${formatRange(tasks[index])}`
                    );

                    return;
                }


                /*
                   Open advanced activity selector
                */

                openActivityPopup(index);

            },
            true
        );


        console.log(
            "NEET OS: Daily Repair + Self Study Add-on loaded."
        );
    }


    /* =====================================================
       INITIALIZE
       ===================================================== */

    if (
        document.readyState ===
        "loading"
    ) {

        document.addEventListener(
            "DOMContentLoaded",
            installButtonInterceptor,
            {
                once: true
            }
        );

    } else {

        installButtonInterceptor();

    }


    /* =====================================================
       DEBUG API
       ===================================================== */

    window.NEETOSRepairAddon = {

        version:
            ADDON_VERSION,

        repairIndex:
            REPAIR_INDEX,

        selfStudyIndex:
            SELF_STUDY_INDEX,

        openRepair:
            () => openActivityPopup(
                REPAIR_INDEX
            ),

        openSelfStudy:
            () => openActivityPopup(
                SELF_STUDY_INDEX
            ),

        sessions:
            () =>
                data?.addonSessions || []

    };


})();
/* =========================================================
   NEET OS
   COMPLETE TEST IN SELF STUDY
   VERSION 3.0

   IMPORTANT:
   - APPEND ONLY
   - Remove previous Test addons before using this.
   - Do NOT remove/replace Self Study addon.
   ========================================================= */

(function NEETOS_COMPLETE_TEST_ADDON() {

    "use strict";

    if (window.NEETOS_COMPLETE_TEST_LOADED) {
        console.warn(
            "NEET OS Test Addon already loaded."
        );
        return;
    }

    window.NEETOS_COMPLETE_TEST_LOADED = true;


    /* =====================================================
       CONFIG
       ===================================================== */

    const TEST_POPUP_ID =
        "neetosTestPopup";

    const TEST_BUTTON_ID =
        "neetosTestButton";

    const TEST_STATS_ID =
        "neetosTestAnalysis";

    const DAY_MS =
        24 * 60 * 60 * 1000;

    let timer = null;

    let observer = null;


    /* =====================================================
       BASIC HELPERS
       ===================================================== */

    function testData() {

        if (!data) {
            return null;
        }

        if (
            !Array.isArray(
                data.testRecords
            )
        ) {
            data.testRecords = [];
        }

        return data;

    }


    function records() {

        return testData()
            ?.testRecords || [];

    }


    function saveTestData() {

        try {
            saveData();
        } catch (error) {
            console.error(
                "NEET OS Test save error:",
                error
            );
        }

    }


    function closeTestPopup() {

        const popup =
            document.getElementById(
                TEST_POPUP_ID
            );

        if (popup) {
            popup.remove();
        }

    }


    function escapeHTML(value) {

        const div =
            document.createElement(
                "div"
            );

        div.textContent =
            String(value ?? "");

        return div.innerHTML;

    }


    function numberValue(
        value,
        fallback = 0
    ) {

        const n =
            Number(value);

        return Number.isFinite(n)
            ? n
            : fallback;

    }


    /* =====================================================
       RELEASE ORIGINAL SELF STUDY POPUP
       ===================================================== */

    /*
       VERY IMPORTANT

       The original Self Study addon has its own
       internal addonBusy variable.

       Its own Cancel button resets addonBusy=false.

       Therefore Test NEVER directly removes
       #neetosAddonPopup.

       We click the original Cancel button.
    */

    function releaseSelfStudy() {

        const popup =
            document.getElementById(
                "neetosAddonPopup"
            );

        if (!popup) {
            return;
        }


        const buttons =
            Array.from(
                popup.querySelectorAll(
                    "button"
                )
            );


        const cancel =
            buttons.find(
                button => {

                    const text =
                        (
                            button.textContent ||
                            ""
                        )
                        .trim()
                        .toLowerCase();

                    return text === "cancel";

                }
            );


        if (cancel) {

            cancel.click();

        } else {

            console.warn(
                "NEET OS Test: Self Study Cancel button not found."
            );

        }

    }


    /* =====================================================
       POPUP CREATOR
       ===================================================== */

    function createPopup(
        title,
        subtitle = ""
    ) {

        closeTestPopup();


        const overlay =
            document.createElement(
                "div"
            );

        overlay.id =
            TEST_POPUP_ID;


        overlay.style.cssText = `
            position:fixed;
            inset:0;
            z-index:9999999;

            display:flex;
            align-items:center;
            justify-content:center;

            padding:18px;
            box-sizing:border-box;

            background:
                rgba(0,0,0,.82);
        `;


        const box =
            document.createElement(
                "div"
            );


        box.style.cssText = `
            width:min(560px,96vw);
            max-height:92vh;

            overflow-y:auto;

            padding:22px;
            box-sizing:border-box;

            border-radius:22px;

            background:
                #10253d;

            border:
                1px solid
                rgba(100,210,255,.35);

            box-shadow:
                0 25px 90px
                rgba(0,0,0,.65);

            color:#fff;

            font-family:
                Arial,
                sans-serif;
        `;


        const heading =
            document.createElement(
                "div"
            );

        heading.textContent =
            title;


        heading.style.cssText = `
            font-size:24px;
            font-weight:800;
            margin-bottom:7px;
        `;


        const description =
            document.createElement(
                "div"
            );

        description.textContent =
            subtitle;


        description.style.cssText = `
            font-size:14px;
            color:#b9cbdc;
            line-height:1.5;
            margin-bottom:18px;
        `;


        box.appendChild(
            heading
        );

        box.appendChild(
            description
        );


        overlay.appendChild(
            box
        );

        document.body.appendChild(
            overlay
        );


        /* Backdrop close */

        overlay.addEventListener(
            "click",
            event => {

                if (
                    event.target ===
                    overlay
                ) {

                    closeTestPopup();

                }

            }
        );


        return {
            overlay,
            box
        };

    }


    /* =====================================================
       BUTTON
       ===================================================== */

    function button(
        text,
        callback,
        primary = true
    ) {

        const btn =
            document.createElement(
                "button"
            );


        btn.type =
            "button";

        btn.textContent =
            text;


        btn.style.cssText = `
            width:100%;

            padding:14px 16px;

            margin:6px 0;

            border-radius:13px;

            border:
                1px solid
                rgba(120,220,255,.28);

            background:
                ${primary
                    ? "#1678a8"
                    : "#163451"};

            color:#fff;

            font-size:15px;

            font-weight:800;

            cursor:pointer;

            box-sizing:border-box;
        `;


        btn.addEventListener(
            "click",
            event => {

                event.preventDefault();

                event.stopPropagation();

                callback();

            }
        );


        return btn;

    }


    function closeBtn() {

        return button(
            "✕ Close",
            closeTestPopup,
            false
        );

    }


    /* =====================================================
       INPUT
       ===================================================== */

    function inputField(
        label,
        id,
        type = "number",
        value = "",
        min = null,
        max = null
    ) {

        const wrapper =
            document.createElement(
                "div"
            );


        wrapper.style.cssText = `
            margin:10px 0;
        `;


        const labelElement =
            document.createElement(
                "label"
            );


        labelElement.textContent =
            label;


        labelElement.style.cssText = `
            display:block;

            margin-bottom:6px;

            font-size:13px;

            font-weight:700;

            color:#c8d8e7;
        `;


        const input =
            document.createElement(
                "input"
            );


        input.id =
            id;

        input.type =
            type;

        input.value =
            value;


        if (min !== null) {
            input.min =
                String(min);
        }

        if (max !== null) {
            input.max =
                String(max);
        }


        input.style.cssText = `
            width:100%;

            padding:12px;

            box-sizing:border-box;

            border-radius:11px;

            border:
                1px solid
                rgba(120,220,255,.25);

            background:#0b1d30;

            color:#fff;

            font-size:15px;
        `;


        wrapper.appendChild(
            labelElement
        );

        wrapper.appendChild(
            input
        );


        return wrapper;

    }


    /* =====================================================
       SELECT
       ===================================================== */

    function selectField(
        label,
        id,
        options
    ) {

        const wrapper =
            document.createElement(
                "div"
            );


        wrapper.style.cssText =
            "margin:10px 0;";


        const labelElement =
            document.createElement(
                "label"
            );


        labelElement.textContent =
            label;


        labelElement.style.cssText = `
            display:block;

            margin-bottom:6px;

            font-size:13px;

            font-weight:700;

            color:#c8d8e7;
        `;


        const select =
            document.createElement(
                "select"
            );


        select.id =
            id;


        select.style.cssText = `
            width:100%;

            padding:12px;

            border-radius:11px;

            border:
                1px solid
                rgba(120,220,255,.25);

            background:#0b1d30;

            color:#fff;

            font-size:15px;
        `;


        options.forEach(
            option => {

                const item =
                    document.createElement(
                        "option"
                    );

                item.value =
                    option.value;

                item.textContent =
                    option.label;

                select.appendChild(
                    item
                );

            }
        );


        wrapper.appendChild(
            labelElement
        );

        wrapper.appendChild(
            select
        );


        return wrapper;

    }


    /* =====================================================
       CHAPTERS
       ===================================================== */

    function chaptersFor(
        subject
    ) {

        try {

            if (
                subject ===
                "Physics"
            ) {

                return (
                    SYLLABUS
                        ?.Physics ||
                    []
                );

            }


            if (
                subject ===
                "Chemistry"
            ) {

                return [
                    ...(
                        SYLLABUS
                            ?.["Physical Chemistry"] ||
                        []
                    ),

                    ...(
                        SYLLABUS
                            ?.["Inorganic Chemistry"] ||
                        []
                    ),

                    ...(
                        SYLLABUS
                            ?.["Organic Chemistry"] ||
                        []
                    )
                ];

            }


            if (
                subject ===
                "Botany"
            ) {

                return (
                    SYLLABUS
                        ?.Botany ||
                    []
                );

            }


            if (
                subject ===
                "Zoology"
            ) {

                return (
                    SYLLABUS
                        ?.Zoology ||
                    []
                );

            }

        } catch (
            error
        ) {

            console.error(
                "NEET OS Test syllabus error:",
                error
            );

        }


        return [];

    }


    /* =====================================================
       SUBJECT ROW
       ===================================================== */

    function addSubjectRow(
        container
    ) {

        const row =
            document.createElement(
                "div"
            );


        row.className =
            "neetos-test-row";


        row.style.cssText = `
            padding:13px;

            margin:9px 0;

            border-radius:14px;

            background:
                rgba(255,255,255,.055);

            border:
                1px solid
                rgba(120,220,255,.15);
        `;


        const subject =
            document.createElement(
                "select"
            );


        subject.style.cssText = `
            width:100%;

            padding:11px;

            margin-bottom:8px;

            border-radius:10px;

            background:#0b1d30;

            color:#fff;

            border:
                1px solid
                rgba(120,220,255,.22);
        `;


        [
            "Physics",
            "Chemistry",
            "Botany",
            "Zoology"
        ].forEach(
            name => {

                const option =
                    document.createElement(
                        "option"
                    );

                option.value =
                    name;

                option.textContent =
                    name;

                subject.appendChild(
                    option
                );

            }
        );


        const chapter =
            document.createElement(
                "select"
            );


        chapter.style.cssText = `
            width:100%;

            padding:11px;

            margin-bottom:8px;

            border-radius:10px;

            background:#0b1d30;

            color:#fff;

            border:
                1px solid
                rgba(120,220,255,.22);
        `;


        function loadChapters() {

            chapter.innerHTML =
                "";


            const first =
                document.createElement(
                    "option"
                );

            first.value =
                "";

            first.textContent =
                "Select Chapter";


            chapter.appendChild(
                first
            );


            chaptersFor(
                subject.value
            ).forEach(
                name => {

                    const option =
                        document.createElement(
                            "option"
                        );

                    option.value =
                        name;

                    option.textContent =
                        name;

                    chapter.appendChild(
                        option
                    );

                }
            );

        }


        subject.addEventListener(
            "change",
            loadChapters
        );


        loadChapters();


        const questions =
            document.createElement(
                "input"
            );


        questions.type =
            "number";

        questions.min =
            "1";

        questions.value =
            "45";

        questions.placeholder =
            "Number of Questions";


        questions.style.cssText = `
            width:100%;

            padding:11px;

            box-sizing:border-box;

            border-radius:10px;

            background:#0b1d30;

            color:#fff;

            border:
                1px solid
                rgba(120,220,255,.22);
        `;


        const remove =
            document.createElement(
                "button"
            );


        remove.type =
            "button";

        remove.textContent =
            "Remove";


        remove.style.cssText = `
            width:100%;

            margin-top:8px;

            padding:9px;

            border-radius:9px;

            border:
                1px solid
                rgba(255,100,100,.25);

            background:
                rgba(255,70,70,.08);

            color:#ffbaba;

            cursor:pointer;
        `;


        remove.addEventListener(
            "click",
            event => {

                event.preventDefault();

                event.stopPropagation();

                row.remove();

            }
        );


        row.appendChild(
            subject
        );

        row.appendChild(
            chapter
        );

        row.appendChild(
            questions
        );

        row.appendChild(
            remove
        );


        container.appendChild(
            row
        );

    }


    /* =====================================================
       MAIN TEST MENU
       ===================================================== */

    function openTestMenu() {

        const pending =
            getPendingTests();


        const popup =
            createPopup(
                "📝 Test",
                "Take a new test or update the score of a completed test."
            );


        popup.box.appendChild(
            button(
                "▶ Start Test",
                openTestSetup
            )
        );


        popup.box.appendChild(
            button(
                pending.length
                    ? `📊 Update Test Score (${pending.length})`
                    : "📊 Update Test Score",
                openScoreList
            )
        );


        popup.box.appendChild(
            button(
                "📈 Test Analysis",
                openTestAnalysis,
                false
            )
        );


        popup.box.appendChild(
            closeBtn()
        );

    }


    /* =====================================================
       TEST SETUP
       ===================================================== */

    function openTestSetup() {

        const popup =
            createPopup(
                "▶ Start Test",
                "Select multiple subjects/chapters and configure your test."
            );


        const container =
            document.createElement(
                "div"
            );


        container.id =
            "neetosTestRows";


        addSubjectRow(
            container
        );


        popup.box.appendChild(
            container
        );


        popup.box.appendChild(
            button(
                "＋ Add Subject / Chapter",
                () =>
                    addSubjectRow(
                        container
                    ),
                false
            )
        );


        popup.box.appendChild(
            inputField(
                "Full Marks",
                "neetosTestMarks",
                "number",
                "720",
                "1"
            )
        );


        popup.box.appendChild(
            inputField(
                "Total Time (minutes)",
                "neetosTestMinutes",
                "number",
                "180",
                "1",
                "1440"
            )
        );


        popup.box.appendChild(
            selectField(
                "Test Authority",
                "neetosTestAuthority",
                [
                    {
                        value:
                            "PW Test",
                        label:
                            "PW Test"
                    },
                    {
                        value:
                            "Other Institute's Test",
                        label:
                            "Other Institute's Test"
                    },
                    {
                        value:
                            "Self Test",
                        label:
                            "Self Test"
                    }
                ]
            )
        );


        popup.box.appendChild(
            button(
                "🚀 Start Test Now",
                () => {

                    startConfiguredTest(
                        container
                    );

                }
            )
        );


        popup.box.appendChild(
            closeBtn()
        );

    }


    /* =====================================================
       READ CONFIGURATION
       ===================================================== */

    function startConfiguredTest(
        container
    ) {

        const rows =
            Array.from(
                container.querySelectorAll(
                    ".neetos-test-row"
                )
            );


        const subjects = [];


        rows.forEach(
            row => {

                const selects =
                    row.querySelectorAll(
                        "select"
                    );


                const input =
                    row.querySelector(
                        "input"
                    );


                const subject =
                    selects[0]
                        ?.value ||
                    "";


                const chapter =
                    selects[1]
                        ?.value ||
                    "";


                const questions =
                    Math.max(
                        0,
                        parseInt(
                            input?.value ||
                            "0",
                            10
                        ) || 0
                    );


                if (
                    subject &&
                    chapter &&
                    questions > 0
                ) {

                    subjects.push({
                        subject,
                        chapter,
                        questions
                    });

                }

            }
        );


        if (
            !subjects.length
        ) {

            alert(
                "Please select at least one subject, chapter and question quantity."
            );

            return;

        }


        const fullMarks =
            Math.max(
                1,
                numberValue(
                    document.getElementById(
                        "neetosTestMarks"
                    )?.value,
                    720
                )
            );


        const minutes =
            Math.max(
                1,
                Math.min(
                    1440,
                    numberValue(
                        document.getElementById(
                            "neetosTestMinutes"
                        )?.value,
                        180
                    )
                )
            );


        const authority =
            document.getElementById(
                "neetosTestAuthority"
            )?.value ||
            "Self Test";


        beginTest({
            subjects,
            fullMarks,
            minutes,
            authority
        });

    }


    /* =====================================================
       BEGIN TEST
       ===================================================== */

    function beginTest(
        config
    ) {

        if (
            testData()?.activeTest
        ) {

            alert(
                "A test is already running."
            );

            return;

        }


        const totalQuestions =
            config.subjects.reduce(
                (
                    total,
                    item
                ) =>
                    total +
                    numberValue(
                        item.questions
                    ),
                0
            );


        if (
            totalQuestions <= 0
        ) {

            alert(
                "Total question count must be greater than 0."
            );

            return;

        }


        const now =
            Date.now();


        const test = {

            id:
                "TEST-" +
                now +
                "-" +
                Math.random()
                    .toString(36)
                    .slice(2,8),

            subjects:
                config.subjects,

            totalQuestions,

            fullMarks:
                config.fullMarks,

            durationMinutes:
                config.minutes,

            durationSeconds:
                config.minutes *
                60,

            authority:
                config.authority,

            startedAt:
                now,

            endAt:
                now +
                (
                    config.minutes *
                    60 *
                    1000
                ),

            warned15:
                false

        };


        data.activeTest =
            test;


        saveTestData();


        closeTestPopup();


        showRunningTest();


        startTestTimer();

    }


    /* =====================================================
       RUNNING TEST
       ===================================================== */

    function showRunningTest() {

        const test =
            data?.activeTest;


        if (!test) {
            return;
        }


        const popup =
            createPopup(
                "📝 Test Running",
                `${escapeHTML(test.authority)} • ${test.totalQuestions} Questions`
            );


        const timerBox =
            document.createElement(
                "div"
            );


        timerBox.id =
            "neetosTestTimer";


        timerBox.style.cssText = `
            text-align:center;

            padding:18px;

            margin:5px 0 15px;

            border-radius:16px;

            background:
                rgba(255,255,255,.07);

            font-size:38px;

            font-weight:900;
        `;


        popup.box.appendChild(
            timerBox
        );


        const details =
            document.createElement(
                "div"
            );


        details.style.cssText = `
            padding:13px;

            border-radius:13px;

            background:
                rgba(255,255,255,.05);

            font-size:14px;

            line-height:1.7;
        `;


        details.innerHTML = `
            <b>Total Questions:</b>
            ${test.totalQuestions}

            <br>

            <b>Full Marks:</b>
            ${test.fullMarks}

            <br>

            <b>Authority:</b>
            ${escapeHTML(test.authority)}

            <br><br>

            ${test.subjects
                .map(
                    item =>
                        `
                        ${escapeHTML(item.subject)}
                        —
                        ${escapeHTML(item.chapter)}
                        —
                        ${item.questions} Q
                        `
                )
                .join("<br>")}
        `;


        popup.box.appendChild(
            details
        );


        popup.box.appendChild(
            button(
                "🏁 Finish Test",
                () =>
                    finishTest(
                        "manual"
                    )
            )
        );


        /*
         * Hide only.
         *
         * Test continues in background.
         */

        popup.box.appendChild(
            button(
                "↙ Hide Test Window",
                closeTestPopup,
                false
            )
        );


        updateTimerUI();

    }


    /* =====================================================
       TIMER
       ===================================================== */

    function startTestTimer() {

        clearInterval(
            timer
        );


        timer =
            setInterval(
                () => {

                    const active =
                        data?.activeTest;


                    if (!active) {

                        clearInterval(
                            timer
                        );

                        timer = null;

                        return;

                    }


                    const remaining =
                        Math.max(
                            0,
                            active.endAt -
                            Date.now()
                        );


                    /*
                     * 15 MIN WARNING
                     */

                    if (
                        remaining <=
                            15 * 60 * 1000 &&
                        !active.warned15
                    ) {

                        active.warned15 =
                            true;

                        saveTestData();


                        alert(
                            "⚠️ TEST WARNING\n\n15 minutes remaining."
                        );

                    }


                    updateTimerUI();


                    /*
                     * AUTO FINISH
                     */

                    if (
                        remaining <= 0
                    ) {

                        finishTest(
                            "time-limit"
                        );

                    }

                },
                1000
            );

    }


    function updateTimerUI() {

        const active =
            data?.activeTest;


        if (!active) {
            return;
        }


        const element =
            document.getElementById(
                "neetosTestTimer"
            );


        if (!element) {
            return;
        }


        const remaining =
            Math.max(
                0,
                active.endAt -
                Date.now()
            );


        element.textContent =
            formatTime(
                remaining
            );


        if (
            remaining <=
            15 * 60 * 1000
        ) {

            element.style.background =
                "rgba(255,70,70,.16)";

        }

    }


    function formatTime(
        milliseconds
    ) {

        let seconds =
            Math.ceil(
                Math.max(
                    0,
                    milliseconds
                ) / 1000
            );


        const hours =
            Math.floor(
                seconds / 3600
            );


        seconds %=
            3600;


        const minutes =
            Math.floor(
                seconds / 60
            );


        seconds %=
            60;


        return (
            String(hours)
                .padStart(2,"0") +
            ":" +
            String(minutes)
                .padStart(2,"0") +
            ":" +
            String(seconds)
                .padStart(2,"0")
        );

    }


    /* =====================================================
       FINISH TEST
       ===================================================== */

    function finishTest(
        reason = "manual"
    ) {

        const active =
            data?.activeTest;


        if (!active) {
            return;
        }


        clearInterval(
            timer
        );

        timer = null;


        const record = {

            ...active,

            status:
                "completed",

            completionReason:
                reason,

            completedAt:
                Date.now(),

            score:
                null,

            correct:
                null,

            incorrect:
                null,

            skipped:
                null,

            percentage:
                null

        };


        delete record.warned15;


        data.testRecords =
            data.testRecords || [];


        data.testRecords.push(
            record
        );


        data.activeTest =
            null;


        saveTestData();


        closeTestPopup();


        updateAnalysisCard();


        alert(
            reason ===
                "time-limit"

                ? "⏰ Test time is over.\n\nTest automatically completed.\n\nYou can now update the score."

                : "✅ Test completed.\n\nYou can now update the score."
        );

    }


    /* =====================================================
       PENDING TESTS
       ===================================================== */

    function getPendingTests() {

        const now =
            Date.now();


        return records()
            .filter(
                test => {

                    if (
                        test.score !==
                            null &&
                        test.score !==
                            undefined
                    ) {
                        return false;
                    }


                    if (
                        !test.completedAt
                    ) {
                        return false;
                    }


                    return (
                        now -
                        test.completedAt
                    ) <= DAY_MS;

                }
            );

    }


    /* =====================================================
       SCORE LIST
       ===================================================== */

    function openScoreList() {

        const pending =
            getPendingTests();


        const popup =
            createPopup(
                "📊 Update Test Score",
                "Completed tests remain available for score entry for 24 hours."
            );


        if (!pending.length) {

            const message =
                document.createElement(
                    "div"
                );


            message.style.cssText = `
                padding:16px;

                border-radius:13px;

                background:
                    rgba(255,255,255,.06);

                color:#d0deea;

                line-height:1.6;
            `;


            message.textContent =
                "There are no test results currently available for score entry.";


            popup.box.appendChild(
                message
            );


            popup.box.appendChild(
                closeBtn()
            );


            return;

        }


        pending.forEach(
            test => {

                const card =
                    document.createElement(
                        "div"
                    );


                card.style.cssText = `
                    padding:14px;

                    margin:8px 0;

                    border-radius:14px;

                    background:
                        rgba(255,255,255,.055);

                    border:
                        1px solid
                        rgba(120,220,255,.15);
                `;


                const remaining =
                    Math.max(
                        0,
                        DAY_MS -
                        (
                            Date.now() -
                            test.completedAt
                        )
                    );


                card.innerHTML = `
                    <b>
                        ${escapeHTML(
                            test.authority
                        )}
                    </b>

                    <br>

                    ${test.totalQuestions}
                    Questions •
                    ${test.fullMarks}
                    Marks

                    <br>

                    <small>
                        Completed:
                        ${new Date(
                            test.completedAt
                        ).toLocaleString()}

                        <br>

                        Score entry remaining:
                        ${formatTime(
                            remaining
                        )}
                    </small>
                `;


                card.appendChild(
                    button(
                        "✏️ Enter Score",
                        () =>
                            openScoreForm(
                                test.id
                            )
                    )
                );


                popup.box.appendChild(
                    card
                );

            }
        );


        popup.box.appendChild(
            closeBtn()
        );

    }


    /* =====================================================
       SCORE FORM
       ===================================================== */

    function openScoreForm(
        id
    ) {

        const test =
            records().find(
                item =>
                    item.id === id
            );


        if (!test) {

            alert(
                "Test result not found."
            );

            return;

        }


        if (
            Date.now() -
            test.completedAt >
            DAY_MS
        ) {

            alert(
                "The 24-hour score update period has expired."
            );

            openScoreList();

            return;

        }


        const popup =
            createPopup(
                "✏️ Update Test Score",
                `${test.authority} • ${test.totalQuestions} Questions • ${test.fullMarks} Marks`
            );


        popup.box.appendChild(
            inputField(
                "Obtained Score",
                "neetosObtainedScore",
                "number",
                "",
                "0",
                test.fullMarks
            )
        );


        popup.box.appendChild(
            inputField(
                "Correct Questions (optional)",
                "neetosCorrect",
                "number",
                "",
                "0",
                test.totalQuestions
            )
        );


        popup.box.appendChild(
            inputField(
                "Incorrect Questions (optional)",
                "neetosIncorrect",
                "number",
                "",
                "0",
                test.totalQuestions
            )
        );


        popup.box.appendChild(
            inputField(
                "Skipped Questions (optional)",
                "neetosSkipped",
                "number",
                "",
                "0",
                test.totalQuestions
            )
        );


        popup.box.appendChild(
            button(
                "💾 Save Score",
                () => {

                    const score =
                        numberValue(
                            document.getElementById(
                                "neetosObtainedScore"
                            )?.value,
                            NaN
                        );


                    if (
                        !Number.isFinite(
                            score
                        )
                    ) {

                        alert(
                            "Please enter your obtained score."
                        );

                        return;

                    }


                    if (
                        score < 0 ||
                        score >
                        test.fullMarks
                    ) {

                        alert(
                            `Score must be between 0 and ${test.fullMarks}.`
                        );

                        return;

                    }


                    const correct =
                        Math.max(
                            0,
                            parseInt(
                                document.getElementById(
                                    "neetosCorrect"
                                )?.value ||
                                "0",
                                10
                            ) || 0
                        );


                    const incorrect =
                        Math.max(
                            0,
                            parseInt(
                                document.getElementById(
                                    "neetosIncorrect"
                                )?.value ||
                                "0",
                                10
                            ) || 0
                        );


                    const skipped =
                        Math.max(
                            0,
                            parseInt(
                                document.getElementById(
                                    "neetosSkipped"
                                )?.value ||
                                "0",
                                10
                            ) || 0
                        );


                    if (
                        correct +
                        incorrect +
                        skipped >
                        test.totalQuestions
                    ) {

                        alert(
                            "Correct + Incorrect + Skipped cannot exceed total questions."
                        );

                        return;

                    }


                    test.score =
                        score;

                    test.correct =
                        correct;

                    test.incorrect =
                        incorrect;

                    test.skipped =
                        skipped;

                    test.percentage =
                        Math.round(
                            (
                                score /
                                test.fullMarks
                            ) *
                            100
                        );


                    test.scoreUpdatedAt =
                        Date.now();


                    saveTestData();


                    closeTestPopup();


                    updateAnalysisCard();


                    alert(
                        "✅ Test score saved successfully."
                    );

                }
            )
        );


        popup.box.appendChild(
            closeBtn()
        );

    }


    /* =====================================================
       TEST ANALYSIS
       ===================================================== */

    function getScoredTests() {

        return records()
            .filter(
                test =>
                    test.score !==
                        null &&
                    test.score !==
                        undefined &&
                    Number.isFinite(
                        Number(
                            test.score
                        )
                    )
            );

    }


    function openTestAnalysis() {

        const popup =
            createPopup(
                "📈 Test Analysis",
                "Overview of your recorded tests."
            );


        const all =
            records();


        const scored =
            getScoredTests();


        const pending =
            getPendingTests();


        const average =
            scored.length
                ? Math.round(
                    scored.reduce(
                        (
                            total,
                            test
                        ) =>
                            total +
                            (
                                Number(
                                    test.percentage
                                ) || 0
                            ),
                        0
                    ) /
                    scored.length
                )
                : 0;


        const best =
            scored.length
                ? Math.max(
                    ...scored.map(
                        test =>
                            Number(
                                test.percentage
                            ) || 0
                    )
                )
                : 0;


        const stats =
            document.createElement(
                "div"
            );


        stats.style.cssText = `
            line-height:1.9;

            padding:15px;

            border-radius:14px;

            background:
                rgba(255,255,255,.055);
        `;


        stats.innerHTML = `
            <b>Total Tests:</b>
            ${all.length}

            <br>

            <b>Scored Tests:</b>
            ${scored.length}

            <br>

            <b>Pending Score:</b>
            ${pending.length}

            <br>

            <b>Average:</b>
            ${average}%

            <br>

            <b>Best:</b>
            ${best}%
        `;


        popup.box.appendChild(
            stats
        );


        if (
            all.length
        ) {

            const heading =
                document.createElement(
                    "div"
                );


            heading.textContent =
                "Recent Tests";


            heading.style.cssText = `
                margin-top:16px;
                margin-bottom:8px;
                font-weight:800;
            `;


            popup.box.appendChild(
                heading
            );


            all
                .slice()
                .reverse()
                .slice(0,10)
                .forEach(
                    test => {

                        const item =
                            document.createElement(
                                "div"
                            );


                        item.style.cssText = `
                            padding:10px;

                            margin:6px 0;

                            border-radius:10px;

                            background:
                                rgba(255,255,255,.045);

                            font-size:13px;

                            line-height:1.6;
                        `;


                        item.innerHTML = `
                            <b>
                                ${escapeHTML(
                                    test.authority
                                )}
                            </b>

                            <br>

                            ${test.totalQuestions}
                            Q •
                            ${test.fullMarks}
                            Marks

                            <br>

                            ${
                                test.score ===
                                    null ||
                                test.score ===
                                    undefined

                                ? "⏳ Score Pending"

                                : `Score:
                                   ${test.score}/${test.fullMarks}
                                   (${test.percentage}%)`
                            }

                            <br>

                            <small>
                                ${new Date(
                                    test.completedAt
                                ).toLocaleString()}
                            </small>
                        `;


                        popup.box.appendChild(
                            item
                        );

                    }
                );

        }


        popup.box.appendChild(
            closeBtn()
        );

    }


    /* =====================================================
       STATS SECTION CARD
       ===================================================== */

    function updateAnalysisCard() {

        const section =
            document.getElementById(
                "statsSection"
            );


        if (!section) {
            return;
        }


        let card =
            document.getElementById(
                TEST_STATS_ID
            );


        if (!card) {

            card =
                document.createElement(
                    "div"
                );

            card.id =
                TEST_STATS_ID;

            card.className =
                "simple-card";


            section.appendChild(
                card
            );

        }


        const all =
            records();


        const scored =
            getScoredTests();


        const pending =
            getPendingTests();


        const average =
            scored.length
                ? Math.round(
                    scored.reduce(
                        (
                            sum,
                            test
                        ) =>
                            sum +
                            (
                                Number(
                                    test.percentage
                                ) || 0
                            ),
                        0
                    ) /
                    scored.length
                )
                : 0;


        const best =
            scored.length
                ? Math.max(
                    ...scored.map(
                        test =>
                            Number(
                                test.percentage
                            ) || 0
                    )
                )
                : 0;


        card.innerHTML = `
            <div style="
                font-size:19px;
                font-weight:800;
                margin-bottom:10px;
            ">
                📝 Test Analysis
            </div>

            <div style="
                line-height:1.8;
                font-size:14px;
            ">
                <b>Total Tests:</b>
                ${all.length}

                <br>

                <b>Scored:</b>
                ${scored.length}

                <br>

                <b>Pending Score:</b>
                ${pending.length}

                <br>

                <b>Average:</b>
                ${average}%

                <br>

                <b>Best:</b>
                ${best}%
            </div>
        `;

    }


    /* =====================================================
       INJECT TEST BUTTON
       ===================================================== */

    function injectTestButton() {

        const popup =
            document.getElementById(
                "neetosAddonPopup"
            );


        if (!popup) {
            return;
        }


        if (
            popup.querySelector(
                "#" +
                TEST_BUTTON_ID
            )
        ) {
            return;
        }


        const cancel =
            Array.from(
                popup.querySelectorAll(
                    "button"
                )
            ).find(
                button =>
                    (
                        button.textContent ||
                        ""
                    )
                    .trim()
                    .toLowerCase() ===
                    "cancel"
            );


        if (!cancel) {
            return;
        }


        const testButton =
            document.createElement(
                "button"
            );


        testButton.id =
            TEST_BUTTON_ID;


        testButton.type =
            "button";


        testButton.textContent =
            "📝 Test";


        testButton.style.cssText = `
            width:100%;

            padding:15px 16px;

            margin:7px 0;

            border-radius:14px;

            border:
                1px solid
                rgba(120,220,255,.30);

            background:
                #173f61;

            color:#fff;

            font-size:16px;

            font-weight:800;

            text-align:left;

            cursor:pointer;

            box-sizing:border-box;
        `;


        /*
         * THE IMPORTANT PART
         *
         * Do NOT remove #neetosAddonPopup.
         *
         * First execute the original Self Study
         * Cancel button.
         *
         * That resets its private addonBusy=false.
         *
         * Then, on the next event-loop turn,
         * open our separate Test popup.
         */

        testButton.addEventListener(
            "click",
            event => {

                event.preventDefault();

                event.stopPropagation();

                event.stopImmediatePropagation();


                releaseSelfStudy();


                setTimeout(
                    () => {

                        openTestMenu();

                    },
                    0
                );

            }
        );


        cancel.parentNode.insertBefore(
            testButton,
            cancel
        );

    }


    /* =====================================================
       OBSERVER
       ===================================================== */

    function startObserver() {

        if (
            observer ||
            !document.body
        ) {
            return;
        }


        observer =
            new MutationObserver(
                () => {

                    injectTestButton();

                }
            );


        observer.observe(
            document.body,
            {
                childList:true,
                subtree:true
            }
        );


        injectTestButton();

    }


    /* =====================================================
       ACTIVE TEST RESTORE
       ===================================================== */

    function restoreActiveTest() {

        const active =
            data?.activeTest;


        if (!active) {
            return;
        }


        if (
            Date.now() >=
            active.endAt
        ) {

            finishTest(
                "time-limit"
            );

            return;

        }


        startTestTimer();

    }


    /* =====================================================
       PUBLIC API
       ===================================================== */

    window.NEETOSTestAddon = {

        version:
            "3.0.0",

        open:
            openTestMenu,

        start:
            beginTest,

        finish:
            finishTest,

        updateScore:
            openScoreList,

        analysis:
            openTestAnalysis,

        getRecords:
            () =>
                records().slice(),

        getPending:
            () =>
                getPendingTests().slice(),

        getActive:
            () =>
                data?.activeTest ||
                null

    };


    /* =====================================================
       INITIALIZE
       ===================================================== */

    function initialize() {

        startObserver();

        updateAnalysisCard();

        restoreActiveTest();

        console.log(
            "✅ NEET OS — Complete Test Addon v3.0 loaded."
        );

    }


    if (
        document.readyState ===
        "loading"
    ) {

        document.addEventListener(
            "DOMContentLoaded",
            initialize,
            {
                once:true
            }
        );

    } else {

        initialize();

    }


    /* =====================================================
       SAFETY / TIMER UI
       ===================================================== */

    setInterval(
        () => {

            injectTestButton();

            updateAnalysisCard();

            updateTimerUI();

            /*
             * Safety check if timer somehow stopped.
             */

            if (
                data?.activeTest &&
                !timer
            ) {

                startTestTimer();

            }

        },
        1000
    );


    /* =====================================================
       ESC
       ===================================================== */

    document.addEventListener(
        "keydown",
        event => {

            if (
                event.key !==
                "Escape"
            ) {
                return;
            }


            const popup =
                document.getElementById(
                    TEST_POPUP_ID
                );


            if (!popup) {
                return;
            }


            event.preventDefault();


            /*
             * ESC only hides the Test window.
             * It does NOT finish the active test.
             */

            closeTestPopup();

        },
        true
    );


})();
/* =========================================================
   NEET OS — FINAL STUDY + TEST TIME + SUBJECT + COMPACT FIX
   ---------------------------------------------------------
   APPEND ONLY
   Nothing deleted.
   Nothing existing removed.
   No Firebase changes.
   No MutationObserver.
   ========================================================= */

(function NEETOSFinalStudyStatsFix(){

    "use strict";

    /* =====================================================
       1. TEST TIME CALCULATION
       ===================================================== */

    function getTestRecords(){

        try{

            if(
                typeof data === "undefined" ||
                !data
            ){
                return [];
            }

            return Array.isArray(
                data.testRecords
            )
                ? data.testRecords
                : [];

        }catch(e){

            return [];

        }

    }


    function getCompletedTestSeconds(){

        return getTestRecords().reduce(
            (total,test)=>{

                if(!test) return total;

                /*
                 * Actual time spent:
                 * startedAt → completedAt
                 */

                const start =
                    Number(
                        test.startedAt || 0
                    );

                const end =
                    Number(
                        test.completedAt || 0
                    );

                if(
                    start > 0 &&
                    end > start
                ){

                    return total +
                        Math.floor(
                            (end - start) / 1000
                        );

                }


                /*
                 * Fallback for old records
                 */

                const fallback =
                    Number(
                        test.durationSeconds || 0
                    );

                return total +
                    Math.max(
                        0,
                        fallback
                    );

            },
            0
        );

    }


    function getActiveTestSeconds(){

        try{

            const test =
                data?.activeTest;

            if(!test) return 0;

            const start =
                Number(
                    test.startedAt || 0
                );

            if(!start) return 0;

            return Math.max(
                0,
                Math.floor(
                    (Date.now() - start) /
                    1000
                )
            );

        }catch(e){

            return 0;

        }

    }


    function getAllTestSeconds(){

        return (
            getCompletedTestSeconds() +
            getActiveTestSeconds()
        );

    }


    /* =====================================================
       2. PATCH TOTAL STUDY TIME
       ===================================================== */

    if(
        typeof getTotalStudySeconds ===
        "function" &&
        !window.NEETOS_TestTimePatched
    ){

        const originalGetTotalStudySeconds =
            getTotalStudySeconds;


        getTotalStudySeconds =
            function(){

                const normalStudy =
                    Number(
                        originalGetTotalStudySeconds() ||
                        0
                    );

                const testStudy =
                    getAllTestSeconds();


                return (
                    normalStudy +
                    testStudy
                );

            };


        window.NEETOS_TestTimePatched =
            true;

    }


    /* =====================================================
       3. SUBJECT BREAKDOWN
       ===================================================== */

    function getSubjectSeconds(subject){

        let seconds = 0;


        try{

            /*
             * Normal scheduled tasks
             * + Self Study task
             */

            if(
                typeof tasks !== "undefined" &&
                Array.isArray(tasks)
            ){

                tasks.forEach(
                    (task,index)=>{

                        if(!task) return;


                        const meta =
                            data?.taskMeta?.[index] ||
                            {};


                        /*
                         * Normal task subject
                         */

                        let taskSubject =
                            task.subject;


                        /*
                         * Self Study / addon subject
                         */

                        if(
                            meta.addonSubject
                        ){

                            taskSubject =
                                meta.addonSubject;

                        }


                        if(
                            taskSubject === subject
                        ){

                            seconds +=
                                Number(
                                    data?.studySeconds?.[index] ||
                                    0
                                );


                            /*
                             * If this task is currently
                             * running, include live seconds.
                             */

                            if(
                                data?.activeTask === index &&
                                data?.activeStartTime
                            ){

                                seconds +=
                                    Math.max(
                                        0,
                                        Math.floor(
                                            (
                                                Date.now() -
                                                data.activeStartTime
                                            ) / 1000
                                        )
                                    );

                            }

                        }

                    }
                );

            }

        }catch(e){

            console.warn(
                "NEET OS Subject Stats:",
                e
            );

        }


        return seconds;

    }


    /* =====================================================
       4. FORMAT
       ===================================================== */

    function formatStudyTime(seconds){

        seconds =
            Math.max(
                0,
                Math.floor(
                    Number(seconds) || 0
                )
            );


        const hours =
            Math.floor(
                seconds / 3600
            );


        const minutes =
            Math.floor(
                (seconds % 3600) / 60
            );


        return (
            hours +
            "h " +
            String(minutes)
                .padStart(2,"0") +
            "m"
        );

    }


    /* =====================================================
       5. SUBJECT BREAKDOWN FIX
       ===================================================== */

    function fixSubjectBreakdown(){

        const stats =
            document.getElementById(
                "statsSection"
            );

        if(!stats) return;


        /*
         * Existing Subject Breakdown card
         */

        const cards =
            [
                ...stats.querySelectorAll(
                    ".simple-card"
                )
            ];


        const card =
            cards.find(
                item => {

                    const heading =
                        item.querySelector(
                            "h3"
                        );

                    return (
                        heading &&
                        heading.textContent
                            .trim()
                            .toLowerCase() ===
                        "subject breakdown"
                            .toLowerCase()
                    );

                }
            );


        if(!card) return;


        const rows =
            [
                ...card.querySelectorAll(
                    ".stat-row-page"
                )
            ];


        if(rows.length < 3) return;


        const subjects = [
            "Physics",
            "Chemistry",
            "Biology"
        ];


        subjects.forEach(
            (subject,index)=>{

                const row =
                    rows[index];

                if(!row) return;


                const value =
                    row.querySelector(
                        "strong"
                    );

                if(!value) return;


                const text =
                    formatStudyTime(
                        getSubjectSeconds(
                            subject
                        )
                    );


                if(
                    value.textContent !==
                    text
                ){

                    value.textContent =
                        text;

                }

            }
        );

    }


    /* =====================================================
       6. FORCE STATS AFTER ORIGINAL STATS
       ===================================================== */

    if(
        typeof updateStats ===
        "function" &&
        !window.NEETOS_FinalStatsWrapped
    ){

        const originalUpdateStats =
            updateStats;


        updateStats =
            function(){

                /*
                 * Let original NEET OS
                 * update everything first.
                 */

                originalUpdateStats();


                /*
                 * Then our final values.
                 */

                fixSubjectBreakdown();

            };


        window.NEETOS_FinalStatsWrapped =
            true;

    }


    /* =====================================================
       7. TEST TIME DISPLAY REFRESH
       ===================================================== */

    function refreshStudyDisplays(){

        try{

            const total =
                typeof getTotalStudySeconds ===
                "function"
                    ? getTotalStudySeconds()
                    : 0;


            const text =
                formatStudyTime(
                    total
                );


            /*
             * Main Study Time
             */

            const ids = [

                "studyTime",
                "statsStudyTime",
                "homeStudyTime",
                "summaryStudyTime"

            ];


            ids.forEach(
                id=>{

                    const element =
                        document.getElementById(
                            id
                        );


                    if(
                        element &&
                        element.textContent !==
                        text
                    ){

                        element.textContent =
                            text;

                    }

                }
            );


            /*
             * Subject Breakdown
             */

            fixSubjectBreakdown();

        }catch(e){

            console.warn(
                "NEET OS Final Stats Fix:",
                e
            );

        }

    }


    /* =====================================================
       8. COMPACT LAPTOP UI
       ===================================================== */

    function installCompactUI(){

        if(
            document.getElementById(
                "neetosCompactUIFinal"
            )
        ){
            return;
        }


        const style =
            document.createElement(
                "style"
            );


        style.id =
            "neetosCompactUIFinal";


        style.textContent = `

            /* =============================================
               LAPTOP / DESKTOP ONLY
               ============================================= */

            @media (min-width: 900px){

                body{
                    font-size:14px !important;
                }


                h1{
                    font-size:28px !important;
                }


                h2{
                    font-size:22px !important;
                }


                h3{
                    font-size:18px !important;
                }


                .card,
                .simple-card{
                    padding:16px !important;
                    margin-bottom:14px !important;
                }


                .stat-row-page{
                    padding:10px 4px !important;
                    min-height:42px !important;
                }


                button{
                    font-size:14px !important;
                }


                input,
                select,
                textarea{
                    font-size:14px !important;
                }


                .muted,
                small{
                    font-size:13px !important;
                }


                /*
                 * Task cards
                 */

                .task-card,
                .task-item{
                    padding:14px !important;
                }


                /*
                 * Main headings / page spacing
                 */

                section{
                    margin-bottom:14px !important;
                }

            }

        `;


        document.head.appendChild(
            style
        );

    }


    /* =====================================================
       9. INITIALIZE
       ===================================================== */

    function initialize(){

        installCompactUI();

        refreshStudyDisplays();


        /*
         * Existing NEET OS already updates
         * every second.
         *
         * This addon only corrects the
         * final displayed values.
         */

        setInterval(
            refreshStudyDisplays,
            1000
        );


        console.log(
            "NEET OS: Final Study + Test Time + Subject + Compact UI addon loaded."
        );

    }


    if(
        document.readyState ===
        "loading"
    ){

        document.addEventListener(
            "DOMContentLoaded",
            initialize,
            {
                once:true
            }
        );

    }else{

        setTimeout(
            initialize,
            500
        );

    }


    window.NEETOSFinalStudyStatsFix = {

        version:"1.0.0",

        getTestSeconds:
            getAllTestSeconds,

        getSubjectSeconds,

        refresh:
            refreshStudyDisplays

    };

})();
/* =========================================================
   NEET OS — FINAL UNIFIED STUDY / CHAPTER ANALYTICS
   ---------------------------------------------------------
   VERSION: 4.0.0

   COVERS:
   ✓ All scheduled tasks
   ✓ Self Study
   ✓ Daily Repair
   ✓ Classes
   ✓ Question Practice
   ✓ Revision
   ✓ Biology Revision
   ✓ Physics Question Practice

   GROUPING:
   SAME SUBJECT + SAME CHAPTER
        → MERGE
        → ADD DURATION
        → ADD QUESTIONS
        → KEEP ALL TIME SLOTS

   SAME SUBJECT + DIFFERENT CHAPTER
        → SEPARATE CHAPTER BLOCK

   BIOLOGY:
        Botany chapters → BOTANY
        Zoology chapters → ZOOLOGY

   STORAGE:
        data.unifiedStudySessions

   EXISTING:
        data.addonSessions
        → Self Study / Repair

   NO MutationObserver
   NO global DOM patch
   ========================================================= */

(function NEETOSUnifiedStudyAnalytics(){

    "use strict";

    const VERSION = "4.0.0";

    const CARD_ID =
        "neetosUnifiedStudyAnalytics";


    const SUBJECTS = [
        "Physics",
        "Chemistry",
        "Botany",
        "Zoology"
    ];


    /* =====================================================
       BASIC HELPERS
       ===================================================== */

    function num(value){

        const n = Number(value);

        return Number.isFinite(n)
            ? Math.max(0,n)
            : 0;

    }


    function esc(value){

        return String(
            value ?? ""
        ).replace(
            /[&<>"']/g,
            c => ({
                "&":"&amp;",
                "<":"&lt;",
                ">":"&gt;",
                '"':"&quot;",
                "'":"&#39;"
            }[c])
        );

    }


    function formatDuration(seconds){

        seconds =
            Math.floor(
                num(seconds)
            );


        const h =
            Math.floor(
                seconds / 3600
            );


        const m =
            Math.floor(
                (seconds % 3600) / 60
            );


        const s =
            seconds % 60;


        if(h > 0){

            return (
                h + "h " +
                String(m).padStart(2,"0") +
                "m"
            );

        }


        if(m > 0){

            return (
                m + "m " +
                String(s).padStart(2,"0") +
                "s"
            );

        }


        return s + "s";

    }


    function formatTime(timestamp){

        if(!timestamp)
            return "—";


        try{

            return new Date(
                timestamp
            ).toLocaleTimeString(
                "en-IN",
                {
                    hour:"numeric",
                    minute:"2-digit"
                }
            );

        }catch(e){

            return "—";

        }

    }


    /* =====================================================
       SUBJECT DETECTION
       ===================================================== */

    function normalizeSubject(
        subject,
        chapter
    ){

        const s =
            String(
                subject || ""
            )
            .trim()
            .toLowerCase();


        if(s === "physics")
            return "Physics";


        if(s === "chemistry")
            return "Chemistry";


        if(s === "botany")
            return "Botany";


        if(s === "zoology")
            return "Zoology";


        /*
         * Biology needs chapter-based classification.
         */

        if(s === "biology"){

            const ch =
                String(
                    chapter || ""
                ).trim();


            const botany =
                Array.isArray(
                    window.SYLLABUS?.Botany
                )
                    ? window.SYLLABUS.Botany
                    : (
                        typeof SYLLABUS !==
                        "undefined"
                            ? (
                                SYLLABUS.Botany ||
                                []
                              )
                            : []
                      );


            const zoology =
                Array.isArray(
                    window.SYLLABUS?.Zoology
                )
                    ? window.SYLLABUS.Zoology
                    : (
                        typeof SYLLABUS !==
                        "undefined"
                            ? (
                                SYLLABUS.Zoology ||
                                []
                              )
                            : []
                      );


            const clean =
                ch
                .toLowerCase()
                .replace(
                    /\s+/g,
                    " "
                )
                .trim();


            const inBotany =
                botany.some(
                    x =>
                        String(x)
                        .toLowerCase()
                        .replace(
                            /\s+/g,
                            " "
                        )
                        .trim() === clean
                );


            const inZoology =
                zoology.some(
                    x =>
                        String(x)
                        .toLowerCase()
                        .replace(
                            /\s+/g,
                            " "
                        )
                        .trim() === clean
                );


            if(inBotany)
                return "Botany";


            if(inZoology)
                return "Zoology";


            /*
             * Fallback if an old/unknown Biology
             * chapter is found.
             */

            return "Botany";

        }


        return "";

    }


    /* =====================================================
       CHAPTER NORMALIZER
       ===================================================== */

    function normalizeChapter(
        chapter
    ){

        const value =
            String(
                chapter ||
                "Chapter not specified"
            ).trim();


        if(!value)
            return "Chapter not specified";


        return value;

    }


    function chapterKey(
        chapter
    ){

        return String(
            chapter
        )
        .toLowerCase()
        .replace(
            /\s+/g,
            " "
        )
        .trim();

    }


    /* =====================================================
       TODAY'S STUDY DAY
       ===================================================== */

    function todayKey(){

        try{

            if(
                typeof getStudyDayKey ===
                "function"
            ){

                return getStudyDayKey();

            }

        }catch(e){}


        return data?.date || "";

    }


    /* =====================================================
       EXISTING ADDON SESSIONS
       -----------------------------------------------------
       Self Study + Daily Repair
       ===================================================== */

    function getAddonSessions(){

        if(
            typeof data === "undefined" ||
            !data
        ){

            return [];

        }


        return Array.isArray(
            data.addonSessions
        )
            ? data.addonSessions
            : [];

    }


    /* =====================================================
       NORMAL / SCHEDULED SESSIONS
       ===================================================== */

    function getUnifiedSessions(){

        if(
            typeof data === "undefined" ||
            !data
        ){

            return [];

        }


        return Array.isArray(
            data.unifiedStudySessions
        )
            ? data.unifiedStudySessions
            : [];

    }


    /* =====================================================
       COMBINE ALL STUDY SESSIONS
       ===================================================== */

    function getAllTodaySessions(){

        const today =
            String(
                todayKey()
            );


        const result = [];


        /*
         * ---------------------------------------------
         * SELF STUDY / REPAIR
         * ---------------------------------------------
         */

        getAddonSessions().forEach(
            session => {

                if(
                    session?.date &&
                    String(
                        session.date
                    ) !== today
                ){

                    return;

                }


                const chapter =
                    normalizeChapter(
                        session.chapter
                    );


                const subject =
                    normalizeSubject(
                        session.subject,
                        chapter
                    );


                if(
                    !SUBJECTS.includes(
                        subject
                    )
                ){

                    return;

                }


                result.push({

                    source:
                        "addon",

                    taskIndex:
                        session.taskIndex,

                    taskName:
                        session.taskName ||
                        "Study",

                    activity:
                        session.activity ||
                        "Study",

                    subject,

                    chapter,

                    seconds:
                        num(
                            session.seconds
                        ),

                    questions:
                        num(
                            session.questions
                        ),

                    startedAt:
                        num(
                            session.startedAt
                        ),

                    stoppedAt:
                        num(
                            session.stoppedAt
                        )

                });

            }
        );


        /*
         * ---------------------------------------------
         * NORMAL SCHEDULED TASKS
         * ---------------------------------------------
         */

        getUnifiedSessions().forEach(
            session => {

                if(
                    session?.date &&
                    String(
                        session.date
                    ) !== today
                ){

                    return;

                }


                const chapter =
                    normalizeChapter(
                        session.chapter
                    );


                const subject =
                    normalizeSubject(
                        session.subject,
                        chapter
                    );


                if(
                    !SUBJECTS.includes(
                        subject
                    )
                ){

                    return;

                }


                result.push({

                    source:
                        "scheduled",

                    taskIndex:
                        session.taskIndex,

                    taskName:
                        session.taskName ||
                        "Scheduled Study",

                    activity:
                        session.activity ||
                        session.taskName ||
                        "Study",

                    subject,

                    chapter,

                    seconds:
                        num(
                            session.seconds
                        ),

                    questions:
                        num(
                            session.questions
                        ),

                    startedAt:
                        num(
                            session.startedAt
                        ),

                    stoppedAt:
                        num(
                            session.stoppedAt
                        )

                });

            }
        );


        return result;

    }


    /* =====================================================
       ACTIVE NORMAL TASK TRACKING
       -----------------------------------------------------
       We watch the existing NEET OS activeTask.

       We DO NOT interfere with the timer.
       ===================================================== */

    let activeSnapshot =
        null;


    let lastCompletedSignature =
        "";


    function captureActiveTask(){

        if(
            typeof data === "undefined" ||
            !data
        ){

            return;

        }


        const index =
            Number.isInteger(
                data.activeTask
            )
                ? data.activeTask
                : null;


        if(index === null){

            /*
             * No active task.
             */

            return;

        }


        if(
            typeof tasks === "undefined" ||
            !tasks[index]
        ){

            return;

        }


        const task =
            tasks[index];


        /*
         * Self Study and Daily Repair are already
         * recorded by the existing addonSessions system.
         *
         * DO NOT duplicate them.
         */

        if(
            task.type === "self-study" ||
            task.type === "repair"
        ){

            activeSnapshot = null;

            return;

        }


        const meta =
            data.taskMeta?.[index] ||
            {};


        const chapter =
            normalizeChapter(
                meta.chapter
            );


        const subject =
            normalizeSubject(
                task.subject,
                chapter
            );


        activeSnapshot = {

            index,

            taskName:
                task.name,

            activity:
                task.name,

            subject,

            chapter,

            startedAt:
                num(
                    data.activeStartTime
                ),

            questionBefore:
                num(
                    data.questionCounts?.[
                        index
                    ]
                )

        };

    }


    /* =====================================================
       CREATE NORMAL SESSION AFTER STOP
       ===================================================== */

    function finalizeNormalTask(){

        if(
            !activeSnapshot
        ){

            return;

        }


        const snapshot =
            activeSnapshot;


        activeSnapshot =
            null;


        if(
            typeof data === "undefined" ||
            !data
        ){

            return;

        }


        /*
         * If the same task somehow gets processed
         * twice, don't duplicate it.
         */

        const signature =
            [
                snapshot.index,
                snapshot.startedAt
            ].join(
                "_"
            );


        if(
            signature ===
            lastCompletedSignature
        ){

            return;

        }


        lastCompletedSignature =
            signature;


        const stoppedAt =
            Date.now();


        const seconds =
            snapshot.startedAt
                ? Math.max(
                    0,
                    Math.floor(
                        (
                            stoppedAt -
                            snapshot.startedAt
                        ) / 1000
                    )
                )
                : 0;


        /*
         * Normal task question count.
         *
         * stopTask() has already updated
         * data.questionCounts before saveData().
         */

        const questions =
            num(
                data.questionCounts?.[
                    snapshot.index
                ]
            );


        /*
         * Don't save zero-length accidental sessions.
         */

        if(
            seconds <= 0
        ){

            return;

        }


        /*
         * Create unified storage.
         */

        if(
            !Array.isArray(
                data.unifiedStudySessions
            )
        ){

            data.unifiedStudySessions =
                [];

        }


        data.unifiedStudySessions.push({

            version:
                VERSION,

            date:
                getStudyDayForSession(
                    snapshot.startedAt
                ),

            taskIndex:
                snapshot.index,

            taskName:
                snapshot.taskName,

            activity:
                snapshot.activity,

            subject:
                snapshot.subject,

            chapter:
                snapshot.chapter,

            seconds,

            questions,

            startedAt:
                snapshot.startedAt,

            stoppedAt

        });


        /*
         * Save using existing NEET OS save engine.
         */

        try{

            if(
                typeof saveData ===
                "function"
            ){

                saveData();

            }

        }catch(error){

            console.warn(
                "Unified session save error:",
                error
            );

        }


        console.log(
            "NEET OS Unified Study Session saved:",
            data.unifiedStudySessions[
                data.unifiedStudySessions.length - 1
            ]
        );

    }


    /* =====================================================
       STUDY DAY FOR TIMESTAMP
       -----------------------------------------------------
       00:00–02:59 belongs to previous study day.
       ===================================================== */

    function getStudyDayForSession(
        timestamp
    ){

        try{

            const d =
                new Date(
                    timestamp ||
                    Date.now()
                );


            if(
                d.getHours() < 3
            ){

                d.setDate(
                    d.getDate() - 1
                );

            }


            return (
                d.getFullYear() +
                "-" +
                String(
                    d.getMonth() + 1
                ).padStart(2,"0") +
                "-" +
                String(
                    d.getDate()
                ).padStart(2,"0")
            );

        }catch(e){

            return todayKey();

        }

    }


    /* =====================================================
       MONITOR TASK START / STOP
       ===================================================== */

    function monitorTaskState(){

        if(
            typeof data === "undefined" ||
            !data
        ){

            return;

        }


        const current =
            Number.isInteger(
                data.activeTask
            )
                ? data.activeTask
                : null;


        /*
         * If a task is running and we don't have
         * its snapshot yet, capture it.
         */

        if(
            current !== null &&
            !activeSnapshot
        ){

            captureActiveTask();

            return;

        }


        /*
         * If our tracked task stopped:
         */

        if(
            current === null &&
            activeSnapshot
        ){

            finalizeNormalTask();

            return;

        }


        /*
         * If task switched unexpectedly,
         * finalize previous one first.
         */

        if(
            activeSnapshot &&
            current !== null &&
            current !==
            activeSnapshot.index
        ){

            finalizeNormalTask();

            captureActiveTask();

        }

    }


    /* =====================================================
       GROUP ALL DATA
       ===================================================== */

    function buildGroupedData(){

        const grouped = {};


        SUBJECTS.forEach(
            subject => {

                grouped[subject] = {};

            }
        );


        getAllTodaySessions().forEach(
            session => {

                const subject =
                    session.subject;


                if(
                    !grouped[subject]
                ){

                    return;

                }


                const chapter =
                    normalizeChapter(
                        session.chapter
                    );


                const key =
                    chapterKey(
                        chapter
                    );


                if(
                    !grouped[subject][key]
                ){

                    grouped[subject][key] = {

                        chapter,

                        duration:0,

                        questions:0,

                        times:[],

                        sessions:0

                    };

                }


                const item =
                    grouped[subject][key];


                /*
                 * ADD TIME
                 */

                item.duration +=
                    num(
                        session.seconds
                    );


                /*
                 * ADD QUESTIONS
                 */

                item.questions +=
                    num(
                        session.questions
                    );


                /*
                 * KEEP EVERY SESSION TIME
                 */

                if(
                    session.startedAt
                ){

                    item.times.push({

                        start:
                            session.startedAt,

                        end:
                            session.stoppedAt

                    });

                }


                item.sessions++;

            }
        );


        /*
         * LIVE CURRENT TASK
         *
         * Show its elapsed time visually,
         * but DO NOT save it again.
         */

        if(
            activeSnapshot &&
            activeSnapshot.startedAt
        ){

            const elapsed =
                Math.max(
                    0,
                    Math.floor(
                        (
                            Date.now() -
                            activeSnapshot.startedAt
                        ) / 1000
                    )
                );


            const subject =
                activeSnapshot.subject;


            const key =
                chapterKey(
                    activeSnapshot.chapter
                );


            if(
                grouped[subject] &&
                !grouped[subject][key]
            ){

                grouped[subject][key] = {

                    chapter:
                        activeSnapshot.chapter,

                    duration:0,

                    questions:0,

                    times:[],

                    sessions:0

                };

            }


            if(
                grouped[subject] &&
                grouped[subject][key]
            ){

                /*
                 * Mark live data separately.
                 *
                 * It is not added permanently.
                 */

                grouped[subject][key]
                    .liveSeconds =
                        elapsed;

                grouped[subject][key]
                    .live =
                        true;

                grouped[subject][key]
                    .liveStartedAt =
                        activeSnapshot.startedAt;

            }

        }


        return grouped;

    }


    /* =====================================================
       SORT CHAPTERS
       ===================================================== */

    function chapterList(
        subjectData
    ){

        return Object.values(
            subjectData
        ).sort(
            (a,b) => {

                const aTime =
                    a.times.length
                        ? Math.max(
                            ...a.times.map(
                                x =>
                                    x.start
                            )
                        )
                        : (
                            a.liveStartedAt ||
                            0
                        );


                const bTime =
                    b.times.length
                        ? Math.max(
                            ...b.times.map(
                                x =>
                                    x.start
                            )
                        )
                        : (
                            b.liveStartedAt ||
                            0
                        );


                return bTime - aTime;

            }
        );

    }


    /* =====================================================
       TIME LINES
       ===================================================== */

    function renderTimes(item){

        let html = "";


        const times =
            item.times
                .slice()
                .sort(
                    (a,b) =>
                        a.start - b.start
                );


        times.forEach(
            time => {

                html += `

                    <span class="
                        neetos-unified-time
                    ">

                        ${esc(
                            formatTime(
                                time.start
                            )
                        )}

                        →

                        ${esc(
                            time.end
                                ? formatTime(
                                    time.end
                                  )
                                : "—"
                        )}

                    </span>

                `;

            }
        );


        if(
            item.live
        ){

            if(
                times.length
            ){

                html += `
                    <span class="
                        neetos-unified-plus
                    ">
                        +
                    </span>
                `;

            }


            html += `

                <span class="
                    neetos-unified-time live
                ">

                    ${esc(
                        formatTime(
                            item.liveStartedAt
                        )
                    )}

                    →

                    NOW

                </span>

            `;

        }


        if(!html){

            html =
                `<span
                    style="opacity:.4"
                >—</span>`;

        }


        return html;

    }


    /* =====================================================
       CHAPTER BLOCK
       ===================================================== */

    function renderChapter(
        item
    ){

        const displayDuration =
            item.duration +
            num(
                item.liveSeconds
            );


        return `

            <div class="
                neetos-unified-chapter
            ">

                <div class="
                    neetos-unified-chapter-name
                ">

                    <span>
                        Chapter:
                    </span>

                    <b>
                        ${esc(
                            item.chapter
                        )}
                    </b>

                </div>


                <div class="
                    neetos-unified-row
                ">

                    <span>
                        Duration:
                    </span>

                    <b>
                        ${formatDuration(
                            displayDuration
                        )}
                    </b>

                </div>


                <div class="
                    neetos-unified-row
                ">

                    <span>
                        Question:
                    </span>

                    <b>
                        ${num(
                            item.questions
                        )}
                    </b>

                </div>


                <div class="
                    neetos-unified-time-row
                ">

                    <span>
                        Time:
                    </span>

                    <div>
                        ${renderTimes(
                            item
                        )}
                    </div>

                </div>

            </div>

        `;

    }


    /* =====================================================
       SUBJECT COLUMN
       ===================================================== */

    function renderSubject(
        subject,
        chapters
    ){

        let totalTime = 0;

        let totalQuestions = 0;


        chapters.forEach(
            item => {

                totalTime +=
                    item.duration +
                    num(
                        item.liveSeconds
                    );

                totalQuestions +=
                    item.questions;

            }
        );


        let html = `

            <div class="
                neetos-unified-subject
            ">

                <div class="
                    neetos-unified-subject-title
                ">

                    ${subject.toUpperCase()}

                </div>


                <div class="
                    neetos-unified-total
                ">

                    <span>
                        Today's Total
                    </span>

                    <b>
                        ${formatDuration(
                            totalTime
                        )}
                    </b>

                </div>


                <div class="
                    neetos-unified-total-q
                ">

                    Questions:
                    <b>
                        ${totalQuestions}
                    </b>

                </div>

        `;


        if(
            !chapters.length
        ){

            html += `

                <div class="
                    neetos-unified-empty
                ">

                    No study data today.

                </div>

            `;

        }else{

            chapters.forEach(
                item => {

                    html +=
                        renderChapter(
                            item
                        );

                }
            );

        }


        html += `

            </div>

        `;


        return html;

    }


    /* =====================================================
       CARD
       ===================================================== */

    function getCard(){

        const section =
            document.getElementById(
                "statsSection"
            ) ||
            document.getElementById(
                "statsPage"
            );


        if(!section)
            return null;


        let card =
            document.getElementById(
                CARD_ID
            );


        if(card)
            return card;


        card =
            document.createElement(
                "div"
            );


        card.id =
            CARD_ID;


        card.className =
            "simple-card";


        const first =
            section.querySelector(
                ".simple-card"
            );


        if(first){

            section.insertBefore(
                card,
                first
            );

        }else{

            section.appendChild(
                card
            );

        }


        return card;

    }


    /* =====================================================
       REMOVE / HIDE OLD ADDON CARDS
       ===================================================== */

    function removeOldAddonCards(){

        const oldIds = [

            "neetosFinalChapterBreakdownV3",

            "neetosFinalSubjectAnalytics",

            "neetosFinalQuestionAnalytics",

            "neetosFinalSessionDetail",

            "neetosFinalQuestionBreakdown"

        ];


        oldIds.forEach(
            id => {

                const el =
                    document.getElementById(
                        id
                    );


                if(el){

                    el.remove();

                }

            }
        );


        /*
         * Hide the old built-in Subject Breakdown
         * if it is present.
         */

        const section =
            document.getElementById(
                "statsSection"
            );


        if(!section)
            return;


        section
            .querySelectorAll(
                ".simple-card"
            )
            .forEach(
                card => {

                    if(
                        card.id === CARD_ID
                    ){

                        return;

                    }


                    const h =
                        card.querySelector(
                            "h3"
                        );


                    const title =
                        (
                            h?.textContent ||
                            ""
                        )
                        .trim()
                        .toLowerCase();


                    if(
                        title ===
                        "subject breakdown"
                    ){

                        card.style.display =
                            "none";

                    }

                }
            );

    }


    /* =====================================================
       RENDER
       ===================================================== */

    function render(){

        try{

            if(
                typeof data === "undefined" ||
                !data
            ){

                return;

            }


            removeOldAddonCards();


            const card =
                getCard();


            if(!card)
                return;


            const grouped =
                buildGroupedData();


            /*
             * Stable signature.
             *
             * If data didn't change,
             * DON'T rewrite innerHTML.
             *
             * This prevents blinking.
             */

            const signature =
                JSON.stringify(
                    grouped
                );


            if(
                card.dataset.signature ===
                signature
            ){

                return;

            }


            card.dataset.signature =
                signature;


            let html = `

                <div class="
                    neetos-unified-heading
                ">

                    Subject Breakdown

                </div>


                <div class="
                    neetos-unified-subtitle
                ">

                    Today's Total •
                    All Study Tasks •
                    Chapter-wise

                </div>


                <div class="
                    neetos-unified-grid
                ">

            `;


            SUBJECTS.forEach(
                subject => {

                    html +=
                        renderSubject(
                            subject,
                            chapterList(
                                grouped[
                                    subject
                                ]
                            )
                        );

                }
            );


            html += `

                </div>

            `;


            card.innerHTML =
                html;


        }catch(error){

            console.warn(
                "NEET OS Unified Analytics:",
                error
            );

        }

    }


    /* =====================================================
       CSS
       ===================================================== */

    function installCSS(){

        if(
            document.getElementById(
                "neetosUnifiedAnalyticsCSS"
            )
        ){

            return;

        }


        const style =
            document.createElement(
                "style"
            );


        style.id =
            "neetosUnifiedAnalyticsCSS";


        style.textContent = `

            #${CARD_ID}{

                width:100%;

                box-sizing:border-box;

                overflow:hidden;

            }


            .neetos-unified-heading{

                font-size:20px;

                font-weight:900;

                margin-bottom:4px;

            }


            .neetos-unified-subtitle{

                font-size:11px;

                opacity:.55;

                margin-bottom:14px;

            }


            /*
             * FOUR COLUMNS
             */

            .neetos-unified-grid{

                display:grid;

                grid-template-columns:
                    repeat(4,minmax(0,1fr));

                gap:8px;

                align-items:start;

                width:100%;

            }


            /*
             * SUBJECT
             */

            .neetos-unified-subject{

                min-width:0;

                padding:9px;

                border-radius:10px;

                box-sizing:border-box;

                background:
                    rgba(255,255,255,.035);

                border:
                    1px solid
                    rgba(255,255,255,.08);

            }


            .neetos-unified-subject-title{

                text-align:center;

                font-size:14px;

                font-weight:900;

                padding-bottom:8px;

                margin-bottom:8px;

                border-bottom:
                    1px solid
                    rgba(255,255,255,.09);

            }


            /*
             * TOTAL
             */

            .neetos-unified-total{

                display:flex;

                justify-content:space-between;

                gap:6px;

                font-size:10px;

                opacity:.65;

            }


            .neetos-unified-total b{

                font-size:12px;

                opacity:1;

            }


            .neetos-unified-total-q{

                font-size:10px;

                opacity:.65;

                padding-bottom:8px;

                margin-top:4px;

                border-bottom:
                    1px solid
                    rgba(255,255,255,.06);

            }


            .neetos-unified-total-q b{

                font-size:12px;

                opacity:1;

            }


            /*
             * CHAPTER
             */

            .neetos-unified-chapter{

                margin-top:8px;

                padding:8px;

                border-radius:8px;

                background:
                    rgba(0,0,0,.12);

                border:
                    1px solid
                    rgba(255,255,255,.055);

            }


            .neetos-unified-chapter-name{

                font-size:10px;

                line-height:1.45;

                margin-bottom:6px;

                overflow-wrap:anywhere;

            }


            .neetos-unified-chapter-name span{

                opacity:.55;

            }


            .neetos-unified-chapter-name b{

                font-size:11px;

            }


            /*
             * INFO
             */

            .neetos-unified-row{

                display:flex;

                justify-content:space-between;

                align-items:center;

                gap:5px;

                font-size:10px;

                line-height:1.6;

            }


            .neetos-unified-row span{

                opacity:.55;

            }


            .neetos-unified-row b{

                font-size:11px;

            }


            /*
             * TIME
             */

            .neetos-unified-time-row{

                display:flex;

                align-items:flex-start;

                gap:5px;

                font-size:10px;

                margin-top:3px;

            }


            .neetos-unified-time-row > span{

                opacity:.55;

                flex-shrink:0;

            }


            .neetos-unified-time-row > div{

                flex:1;

                min-width:0;

                display:flex;

                flex-direction:column;

                align-items:flex-end;

            }


            .neetos-unified-time{

                font-size:9px;

                line-height:1.5;

                text-align:right;

                white-space:nowrap;

            }


            .neetos-unified-time.live{

                font-weight:800;

            }


            .neetos-unified-empty{

                text-align:center;

                padding:12px 3px;

                font-size:10px;

                opacity:.4;

            }


            /*
             * DESKTOP
             */

            @media(min-width:900px){

                .neetos-unified-grid{

                    gap:7px;

                }


                .neetos-unified-subject{

                    padding:8px;

                }


                .neetos-unified-chapter{

                    padding:7px;

                }

            }


            /*
             * TABLET
             */

            @media(max-width:1050px){

                .neetos-unified-grid{

                    grid-template-columns:
                        repeat(2,minmax(0,1fr));

                }

            }


            /*
             * MOBILE
             */

            @media(max-width:600px){

                .neetos-unified-grid{

                    grid-template-columns:
                        repeat(2,minmax(0,1fr));

                    gap:6px;

                }


                .neetos-unified-subject{

                    padding:7px;

                }


                .neetos-unified-subject-title{

                    font-size:12px;

                }


                .neetos-unified-chapter{

                    padding:6px;

                }


                .neetos-unified-time{

                    font-size:8px;

                }

            }


            @media(max-width:400px){

                .neetos-unified-grid{

                    grid-template-columns:
                        1fr;

                }

            }

        `;


        document.head.appendChild(
            style
        );

    }


    /* =====================================================
       MAIN LOOP
       ===================================================== */

    function tick(){

        try{

            monitorTaskState();

            render();

        }catch(error){

            console.warn(
                "NEET OS Unified Analytics tick:",
                error
            );

        }

    }


    /* =====================================================
       INITIALIZATION
       ===================================================== */

    function init(){

        installCSS();

        tick();


        clearInterval(
            window.__NEETOS_UNIFIED_ANALYTICS_TIMER
        );


        window.__NEETOS_UNIFIED_ANALYTICS_TIMER =
            setInterval(
                tick,
                1000
            );


        console.log(
            "✅ NEET OS Unified Study Analytics " +
            VERSION +
            " loaded."
        );

    }


    if(
        document.readyState ===
        "loading"
    ){

        document.addEventListener(
            "DOMContentLoaded",
            init,
            {once:true}
        );

    }else{

        init();

    }

})();
/* =========================================================
   NEET OS — FINAL SCROLL JUMP / AUTO SCROLL FIX
   ---------------------------------------------------------
   APPEND ONLY

   FIXES:
   - Stats live refresh scroll jump
   - Unified Analytics re-render scroll movement
   - Daily Progress live refresh jump
   - Subject Breakdown refresh jump
   - Test Analysis refresh jump
   - Keeps user's manual scroll position
   - Does NOT change:
     • Study timer
     • Task system
     • Firebase
     • Storage
     • Test timer
     • Progress calculation
     • Mobile layout
   ========================================================= */

(function NEETOSFinalScrollStabilizer() {

    "use strict";

    const STATE = {
        lastUserScroll: 0,
        lastScrollY: window.scrollY || 0,
        restoring: false,
        initialized: false
    };

    const USER_SCROLL_WINDOW = 450;

    /* =====================================================
       1. DETECT REAL USER SCROLL
       ===================================================== */

    function markUserScroll() {

        if (STATE.restoring) {
            return;
        }

        STATE.lastUserScroll = Date.now();
        STATE.lastScrollY =
            window.scrollY ||
            window.pageYOffset ||
            0;
    }


    window.addEventListener(
        "scroll",
        markUserScroll,
        {
            passive: true
        }
    );


    /* =====================================================
       2. DISABLE BROWSER SCROLL ANCHORING
       -----------------------------------------------------
       This is important because the Stats cards are
       continuously changing height while the timer runs.
       ===================================================== */

    function installScrollAnchorFix() {

        if (
            document.getElementById(
                "neetosFinalScrollAnchorFix"
            )
        ) {
            return;
        }

        const style =
            document.createElement("style");

        style.id =
            "neetosFinalScrollAnchorFix";

        style.textContent = `

            /*
             * Prevent browser from automatically choosing
             * a new scroll anchor when live cards change.
             */
            #statsSection {
                overflow-anchor: none !important;
            }

            /*
             * Unified analytics card can change height
             * every second.
             */
            #neetosFinalUnifiedAnalytics {
                overflow-anchor: none !important;
            }

            /*
             * Other dynamically refreshed cards.
             */
            #neetOS30DayPerformance,
            #neetosFinalTestStats,
            #neetosFinalTestAnalysis,
            #neetosTestAnalysis {
                overflow-anchor: none !important;
            }

        `;

        document.head.appendChild(style);
    }


    /* =====================================================
       3. SAFE SCROLL POSITION RESTORE
       ===================================================== */

    function restoreScrollPosition(
        expectedY
    ) {

        if (
            !Number.isFinite(
                expectedY
            )
        ) {
            return;
        }

        const currentY =
            window.scrollY ||
            window.pageYOffset ||
            0;

        /*
         * Nothing changed.
         */
        if (
            Math.abs(
                currentY - expectedY
            ) < 1
        ) {
            return;
        }

        /*
         * If the user has manually scrolled
         * very recently, NEVER fight the user.
         */
        if (
            Date.now() -
            STATE.lastUserScroll <
            USER_SCROLL_WINDOW
        ) {
            return;
        }

        STATE.restoring = true;

        window.scrollTo(
            0,
            expectedY
        );

        /*
         * Some browsers apply layout correction
         * one frame later.
         */
        requestAnimationFrame(
            () => {

                const after =
                    window.scrollY ||
                    window.pageYOffset ||
                    0;

                if (
                    Math.abs(
                        after - expectedY
                    ) > 1
                ) {
                    window.scrollTo(
                        0,
                        expectedY
                    );
                }

                STATE.restoring = false;
            }
        );
    }


    /* =====================================================
       4. WATCH ONLY IMPORTANT LIVE CARDS
       -----------------------------------------------------
       ResizeObserver is used instead of MutationObserver.

       This avoids observing the entire document and therefore
       avoids creating another heavy DOM loop.
       ===================================================== */

    let resizeObserver = null;

    function installResizeProtection() {

        if (
            resizeObserver ||
            typeof ResizeObserver ===
                "undefined"
        ) {
            return;
        }

        resizeObserver =
            new ResizeObserver(
                entries => {

                    if (
                        !entries ||
                        !entries.length
                    ) {
                        return;
                    }

                    /*
                     * If user is actively scrolling,
                     * don't interfere.
                     */
                    if (
                        Date.now() -
                        STATE.lastUserScroll <
                        USER_SCROLL_WINDOW
                    ) {
                        return;
                    }

                    const savedY =
                        STATE.lastScrollY;

                    /*
                     * Wait until browser completes
                     * the current layout calculation.
                     */
                    requestAnimationFrame(
                        () => {

                            restoreScrollPosition(
                                savedY
                            );

                        }
                    );
                }
            );


        const observeIds = [

            "statsSection",

            "neetosFinalUnifiedAnalytics",

            "neetOS30DayPerformance",

            "neetosFinalTestStats",

            "neetosFinalTestAnalysis",

            "neetosTestAnalysis"

        ];


        observeIds.forEach(
            id => {

                const element =
                    document.getElementById(
                        id
                    );

                if (element) {

                    resizeObserver.observe(
                        element
                    );

                }

            }
        );
    }


    /* =====================================================
       5. RE-CHECK DYNAMIC CARDS
       -----------------------------------------------------
       Unified Analytics card may be created later.
       We only check a few known elements.
       ===================================================== */

    function refreshObservers() {

        if (!resizeObserver) {
            return;
        }

        const observeIds = [

            "statsSection",

            "neetosFinalUnifiedAnalytics",

            "neetOS30DayPerformance",

            "neetosFinalTestStats",

            "neetosFinalTestAnalysis",

            "neetosTestAnalysis"

        ];


        observeIds.forEach(
            id => {

                const element =
                    document.getElementById(
                        id
                    );

                if (!element) {
                    return;
                }

                try {
                    resizeObserver.observe(
                        element
                    );
                } catch (e) {
                    /*
                     * Already observed.
                     */
                }

            }
        );
    }


    /* =====================================================
       6. PERIODIC SAFE CHECK
       -----------------------------------------------------
       Very lightweight.
       ===================================================== */

    function stabilizerTick() {

        try {

            installScrollAnchorFix();

            refreshObservers();

            /*
             * Only restore if the browser moved the page
             * without a recent user scroll.
             */
            if (
                Date.now() -
                STATE.lastUserScroll >
                USER_SCROLL_WINDOW
            ) {

                const currentY =
                    window.scrollY ||
                    window.pageYOffset ||
                    0;

                const savedY =
                    STATE.lastScrollY;

                /*
                 * Ignore huge differences.
                 *
                 * Huge movement is probably a real
                 * navigation/page change.
                 */
                if (
                    Math.abs(
                        currentY - savedY
                    ) > 0 &&
                    Math.abs(
                        currentY - savedY
                    ) < 180
                ) {

                    restoreScrollPosition(
                        savedY
                    );

                }

            }

        } catch (error) {

            console.warn(
                "NEET OS Scroll Stabilizer:",
                error
            );

        }

    }


    /* =====================================================
       7. INITIALIZATION
       ===================================================== */

    function initialize() {

        if (
            STATE.initialized
        ) {
            return;
        }

        STATE.initialized = true;

        STATE.lastScrollY =
            window.scrollY ||
            window.pageYOffset ||
            0;

        installScrollAnchorFix();

        installResizeProtection();

        refreshObservers();

        /*
         * Give existing addons time to create
         * their Stats cards.
         */
        setTimeout(
            refreshObservers,
            500
        );

        setTimeout(
            refreshObservers,
            1500
        );

        setTimeout(
            refreshObservers,
            3000
        );

        /*
         * Lightweight safety loop.
         */
        clearInterval(
            window.__NEETOS_FINAL_SCROLL_STABILIZER
        );

        window.__NEETOS_FINAL_SCROLL_STABILIZER =
            setInterval(
                stabilizerTick,
                1000
            );

        console.log(
            "✅ NEET OS — Final Scroll Stabilizer loaded."
        );
    }


    if (
        document.readyState ===
        "loading"
    ) {

        document.addEventListener(
            "DOMContentLoaded",
            initialize,
            {
                once: true
            }
        );

    } else {

        initialize();

    }


    /* =====================================================
       PUBLIC DEBUG API
       ===================================================== */

    window.NEETOSScrollStabilizer = {

        version: "1.0.0",

        refresh:
            refreshObservers,

        position:
            () =>
                window.scrollY ||
                window.pageYOffset ||
                0

    };

})();
/* =========================================================
   NEET OS — DIBYENDU SIGMA PREMIUM UI
   ---------------------------------------------------------
   APPEND ONLY
   VISUAL UI ONLY

   ✓ Existing study system untouched
   ✓ Existing timer untouched
   ✓ Existing Test system untouched
   ✓ Existing Self Study untouched
   ✓ Existing Firebase untouched
   ✓ Existing storage untouched
   ✓ Existing calculations untouched
   ✓ Uses user's supplied photos
   ✓ Premium Sigma / Dark Luxury aesthetic
   ========================================================= */

(function NEETOS_DIBYENDU_SIGMA_UI(){

    "use strict";

    if(window.__NEETOS_DIBYENDU_SIGMA_UI_V1){
        return;
    }

    window.__NEETOS_DIBYENDU_SIGMA_UI_V1 = true;


    /* =====================================================
       CONFIG
       ===================================================== */

    const STYLE_ID =
        "neetosDibyenduSigmaPremiumStyle";

    const HERO_ID =
        "neetosSigmaHero";

    const LOGO_ID =
        "neetosSigmaLogo";

    let heroIndex = 0;

    let lastActiveTask = null;

    let lastPage = "";


    /* =====================================================
       USER PHOTOS
       -----------------------------------------------------
       Your supplied photos are already embedded here.
       No external image hosting required.
       ===================================================== */

    const USER_PHOTOS = [

        /* PHOTO 01 */
        "data:image/webp;base64,PASTE_PHOTO_01_BASE64_HERE",

        /* PHOTO 02 */
        "data:image/webp;base64,PASTE_PHOTO_02_BASE64_HERE",

        /* PHOTO 03 */
        "data:image/webp;base64,PASTE_PHOTO_03_BASE64_HERE",

        /* PHOTO 04 */
        "data:image/webp;base64,PASTE_PHOTO_04_BASE64_HERE"

    ];


    /* =====================================================
       PREMIUM CSS
       ===================================================== */

    function installPremiumStyle(){

        if(document.getElementById(STYLE_ID)){
            return;
        }

        const style =
            document.createElement("style");

        style.id = STYLE_ID;

        style.textContent = `

        /* =================================================
           ROOT
           ================================================= */

        :root{

            --neos-black:
                #050505;

            --neos-black-2:
                #090909;

            --neos-card:
                #0d0d0f;

            --neos-card-2:
                #121214;

            --neos-border:
                rgba(255,255,255,.075);

            --neos-red:
                #e50914;

            --neos-red-2:
                #ff3340;

            --neos-white:
                #f7f7f7;

            --neos-muted:
                #8e8e96;

        }


        /* =================================================
           GLOBAL
           ================================================= */

        html{

            scroll-behavior:auto !important;

            background:
                var(--neos-black) !important;

        }


        body{

            background:

                radial-gradient(
                    circle at 50% -10%,
                    rgba(229,9,20,.13),
                    transparent 32%
                ),

                linear-gradient(
                    180deg,
                    #050505 0%,
                    #080808 55%,
                    #050505 100%
                ) !important;

            color:
                var(--neos-white) !important;

            overflow-x:
                hidden !important;

        }


        #app{

            min-height:
                100vh;

            background:
                transparent !important;

        }


        #mainContent{

            width:
                min(100%, 760px);

            margin:
                0 auto;

            padding:
                12px 12px 100px;

            box-sizing:
                border-box;

        }


        /* =================================================
           HEADER
           ================================================= */

        .app-header{

            position:
                sticky !important;

            top:
                0 !important;

            z-index:
                5000 !important;

            height:
                64px !important;

            padding:
                8px 12px !important;

            box-sizing:
                border-box;

            background:
                rgba(5,5,5,.88) !important;

            backdrop-filter:
                blur(22px) saturate(140%);

            -webkit-backdrop-filter:
                blur(22px) saturate(140%);

            border-bottom:
                1px solid
                rgba(255,255,255,.06) !important;

            box-shadow:
                0 8px 30px
                rgba(0,0,0,.35);

        }


        .app-header::after{

            content:"";

            position:
                absolute;

            left:
                0;

            right:
                0;

            bottom:
                -1px;

            height:
                1px;

            background:
                linear-gradient(
                    90deg,
                    transparent,
                    rgba(229,9,20,.75),
                    transparent
                );

            opacity:
                .8;

        }


        .app-header h1{

            display:
                flex !important;

            align-items:
                center;

            gap:
                9px;

            margin:
                0 !important;

            font-size:
                20px !important;

            font-weight:
                900 !important;

            letter-spacing:
                -.4px;

        }


        .app-header p{

            margin:
                2px 0 0 !important;

            color:
                #77777f !important;

            font-size:
                10px !important;

            letter-spacing:
                .35px;

        }


        /* =================================================
           SIGMA LOGO
           ================================================= */

        #${LOGO_ID}{

            width:
                34px;

            height:
                34px;

            flex:
                0 0 34px;

            display:
                flex;

            align-items:
                center;

            justify-content:
                center;

            position:
                relative;

            overflow:
                hidden;

            border-radius:
                11px;

            background:

                linear-gradient(
                    145deg,
                    #ff2633,
                    #870008
                );

            color:
                #fff;

            font-family:
                Arial,
                sans-serif;

            font-size:
                17px;

            font-weight:
                950;

            letter-spacing:
                -1px;

            box-shadow:

                0 0 0 1px
                rgba(255,255,255,.08),

                0 7px 22px
                rgba(229,9,20,.35);

        }


        #${LOGO_ID}::before{

            content:"";

            position:
                absolute;

            width:
                70px;

            height:
                70px;

            top:
                -42px;

            left:
                -42px;

            background:
                rgba(255,255,255,.20);

            transform:
                rotate(25deg);

        }


        #${LOGO_ID} span{

            position:
                relative;

            z-index:
                2;

        }


        /* =================================================
           HEADER ICONS
           ================================================= */

        .icon-button{

            width:
                42px !important;

            height:
                42px !important;

            min-width:
                42px !important;

            border-radius:
                13px !important;

            border:
                1px solid
                rgba(255,255,255,.07) !important;

            background:
                rgba(255,255,255,.045) !important;

            color:
                #fff !important;

            box-shadow:
                none !important;

            transition:
                .18s ease;

        }


        .icon-button:active{

            transform:
                scale(.94);

            background:
                rgba(229,9,20,.15) !important;

            border-color:
                rgba(229,9,20,.45) !important;

        }


        /* =================================================
           PREMIUM CARDS
           ================================================= */

        .card,
        .simple-card,
        .task-card,
        .progress-card,
        .schedule-section{

            background:

                linear-gradient(
                    145deg,
                    rgba(20,20,23,.96),
                    rgba(10,10,12,.98)
                ) !important;

            border:
                1px solid
                var(--neos-border) !important;

            border-radius:
                20px !important;

            box-shadow:

                0 15px 45px
                rgba(0,0,0,.28) !important;

        }


        .simple-card,
        .card{

            padding:
                16px !important;

        }


        /* =================================================
           TODAY HEADER
           ================================================= */

        .today-header{

            margin:
                7px 2px 12px !important;

        }


        .today-header h2{

            font-size:
                25px !important;

            font-weight:
                900 !important;

            letter-spacing:
                -.7px;

        }


        .today-header p{

            color:
                #77777f !important;

        }


        /* =================================================
           PROGRESS CARD
           ================================================= */

        .progress-card{

            position:
                relative;

            overflow:
                hidden;

            padding:
                18px !important;

            border-color:
                rgba(229,9,20,.16) !important;

        }


        .progress-card::before{

            content:"";

            position:
                absolute;

            width:
                170px;

            height:
                170px;

            right:
                -70px;

            top:
                -80px;

            border-radius:
                50%;

            background:
                rgba(229,9,20,.10);

            filter:
                blur(10px);

        }


        .progress-card::after{

            content:"";

            position:
                absolute;

            left:
                0;

            right:
                0;

            bottom:
                0;

            height:
                2px;

            background:
                linear-gradient(
                    90deg,
                    transparent,
                    #e50914,
                    transparent
                );

            opacity:
                .7;

        }


        /* =================================================
           TASK CARDS
           ================================================= */

        .task-card{

            position:
                relative;

            display:
                flex !important;

            align-items:
                center !important;

            gap:
                11px !important;

            padding:
                13px !important;

            margin-bottom:
                9px !important;

            min-height:
                72px;

            transition:
                transform .18s ease,
                border-color .18s ease,
                box-shadow .18s ease;

        }


        .task-card:active{

            transform:
                scale(.985);

        }


        .task-card.neos-active{

            border-color:
                rgba(229,9,20,.65) !important;

            box-shadow:

                0 0 0 1px
                rgba(229,9,20,.10),

                0 12px 38px
                rgba(229,9,20,.16) !important;

        }


        .task-card.neos-active::before{

            content:"";

            position:
                absolute;

            left:
                0;

            top:
                10px;

            bottom:
                10px;

            width:
                3px;

            border-radius:
                4px;

            background:
                #e50914;

            box-shadow:
                0 0 15px
                rgba(229,9,20,.8);

        }


        .task-title{

            font-weight:
                800 !important;

            color:
                #f5f5f5 !important;

        }


        .task-time{

            color:
                #888890 !important;

            font-size:
                11px !important;

        }


        .task-meta{

            color:
                #686870 !important;

            font-size:
                11px !important;

        }


        .start-button{

            min-width:
                65px !important;

            min-height:
                40px !important;

            padding:
                8px 12px !important;

            border-radius:
                12px !important;

            background:

                linear-gradient(
                    145deg,
                    #ef233c,
                    #a90009
                ) !important;

            color:
                #fff !important;

            border:
                0 !important;

            font-weight:
                800 !important;

            box-shadow:
                0 7px 20px
                rgba(229,9,20,.20) !important;

        }


        .neos-now-pill{

            display:
                inline-flex;

            width:
                fit-content;

            margin-top:
                5px;

            padding:
                3px 7px;

            border-radius:
                6px;

            background:
                rgba(229,9,20,.13);

            border:
                1px solid
                rgba(229,9,20,.28);

            color:
                #ff5964;

            font-size:
                8px;

            font-weight:
                900;

            letter-spacing:
                .8px;

        }


        /* =================================================
           SIGMA HERO
           ================================================= */

        #${HERO_ID}{

            position:
                relative;

            height:
                230px;

            margin:
                13px 0;

            overflow:
                hidden;

            border-radius:
                23px;

            background:
                #090909;

            border:
                1px solid
                rgba(255,255,255,.08);

            box-shadow:

                0 20px 55px
                rgba(0,0,0,.40);

        }


        .neos-hero-slide{

            position:
                absolute;

            inset:
                0;

            opacity:
                0;

            transform:
                scale(1.035);

            transition:
                opacity 1s ease,
                transform 7s ease;

            pointer-events:
                none;

        }


        .neos-hero-slide.active{

            opacity:
                1;

            transform:
                scale(1);

        }


        .neos-hero-slide img{

            width:
                100%;

            height:
                100%;

            object-fit:
                cover;

            object-position:
                center;

            display:
                block;

            filter:
                saturate(.82)
                contrast(1.08)
                brightness(.72);

        }


        .neos-hero-slide::after{

            content:"";

            position:
                absolute;

            inset:
                0;

            background:

                linear-gradient(
                    180deg,
                    rgba(0,0,0,.05),
                    rgba(0,0,0,.80)
                );

        }


        .neos-hero-copy{

            position:
                absolute;

            left:
                17px;

            right:
                17px;

            bottom:
                19px;

            z-index:
                3;

        }


        .neos-hero-kicker{

            color:
                #ff4a55;

            font-size:
                9px;

            font-weight:
                900;

            letter-spacing:
                1.7px;

            margin-bottom:
                5px;

        }


        .neos-hero-title{

            color:
                #fff;

            font-size:
                25px;

            line-height:
                1.02;

            font-weight:
                950;

            letter-spacing:
                -1px;

            text-shadow:
                0 3px 15px
                rgba(0,0,0,.65);

        }


        .neos-hero-sub{

            margin-top:
                6px;

            max-width:
                290px;

            color:
                rgba(255,255,255,.68);

            font-size:
                11px;

            line-height:
                1.35;

        }


        .neos-dots{

            position:
                absolute;

            right:
                15px;

            bottom:
                17px;

            z-index:
                5;

            display:
                flex;

            gap:
                5px;

        }


        .neos-dot{

            width:
                5px;

            height:
                5px;

            border-radius:
                50%;

            background:
                rgba(255,255,255,.35);

            transition:
                .25s ease;

        }


        .neos-dot.active{

            width:
                17px;

            border-radius:
                10px;

            background:
                #e50914;

        }


        /* =================================================
           SECTION HEADINGS
           ================================================= */

        .section-heading{

            font-weight:
                900 !important;

            color:
                #f5f5f5 !important;

        }


        /* =================================================
           BOTTOM NAV
           ================================================= */

        .bottom-nav{

            position:
                fixed !important;

            z-index:
                6000 !important;

            left:
                50% !important;

            bottom:
                10px !important;

            transform:
                translateX(-50%) !important;

            width:
                calc(100% - 22px) !important;

            max-width:
                500px !important;

            padding:
                7px !important;

            box-sizing:
                border-box;

            display:
                grid !important;

            grid-template-columns:
                repeat(4,1fr);

            gap:
                5px;

            border:
                1px solid
                rgba(255,255,255,.08) !important;

            border-radius:
                20px !important;

            background:
                rgba(12,12,14,.90) !important;

            backdrop-filter:
                blur(25px) saturate(150%);

            -webkit-backdrop-filter:
                blur(25px) saturate(150%);

            box-shadow:

                0 15px 50px
                rgba(0,0,0,.60);

        }


        .bottom-nav .nav-item{

            min-height:
                49px !important;

            border:
                0 !important;

            border-radius:
                14px !important;

            background:
                transparent !important;

            color:
                #77777f !important;

            font-size:
                10px !important;

            font-weight:
                700 !important;

            transition:
                .18s ease;

        }


        .bottom-nav .nav-item.active{

            color:
                #fff !important;

            background:
                rgba(229,9,20,.12) !important;

            box-shadow:
                inset 0 0 0 1px
                rgba(229,9,20,.16);

        }


        .bottom-nav .nav-item.active span:first-child{

            filter:
                drop-shadow(
                    0 0 7px
                    rgba(229,9,20,.55)
                );

        }


        /* =================================================
           STATS
           ================================================= */

        #statsSection .simple-card{

            border-color:
                rgba(255,255,255,.065) !important;

        }


        .stat-row-page{

            border-color:
                rgba(255,255,255,.055) !important;

        }


        .stat-row-page strong{

            color:
                #fff !important;

        }


        /* =================================================
           BUTTONS
           ================================================= */

        button{

            touch-action:
                manipulation;

        }


        .primary-button,
        button.primary{

            background:

                linear-gradient(
                    145deg,
                    #ef233c,
                    #a90009
                ) !important;

            border:
                0 !important;

            color:
                #fff !important;

            box-shadow:
                0 8px 24px
                rgba(229,9,20,.18) !important;

        }


        .secondary-button{

            background:
                rgba(255,255,255,.045) !important;

            border:
                1px solid
                rgba(255,255,255,.08) !important;

            color:
                #eee !important;

        }


        /* =================================================
           INPUTS / SELECTS
           ================================================= */

        input,
        select,
        textarea{

            background:
                #111113 !important;

            color:
                #f5f5f5 !important;

            border-color:
                rgba(255,255,255,.10) !important;

            border-radius:
                12px !important;

        }


        input:focus,
        select:focus,
        textarea:focus{

            border-color:
                rgba(229,9,20,.65) !important;

            outline:
                none !important;

            box-shadow:
                0 0 0 3px
                rgba(229,9,20,.08) !important;

        }


        /* =================================================
           MOBILE
           ================================================= */

        @media(max-width:600px){

            #mainContent{

                padding:
                    10px 10px 96px;

            }


            .today-header h2{

                font-size:
                    23px !important;

            }


            .progress-card{

                border-radius:
                    18px !important;

            }


            #${HERO_ID}{

                height:
                    235px;

                border-radius:
                    21px;

            }


            .task-card{

                min-height:
                    69px;

                padding:
                    11px !important;

            }


            .task-icon{

                width:
                    40px !important;

                height:
                    40px !important;

                min-width:
                    40px !important;

                border-radius:
                    12px !important;

            }


            .start-button{

                min-width:
                    61px !important;

                font-size:
                    11px !important;

            }


            .simple-card{

                border-radius:
                    18px !important;

            }

        }


        /* =================================================
           SMALL PHONE
           ================================================= */

        @media(max-width:380px){

            .app-header h1{

                font-size:
                    18px !important;

            }


            #${HERO_ID}{

                height:
                    215px;

            }


            .neos-hero-title{

                font-size:
                    22px;

            }


            .task-card{

                gap:
                    8px !important;

            }


            .task-meta{

                max-width:
                    170px;

                white-space:
                    nowrap;

                overflow:
                    hidden;

                text-overflow:
                    ellipsis;

            }

        }


        /* =================================================
           DESKTOP
           ================================================= */

        @media(min-width:700px){

            #mainContent{

                max-width:
                    900px;

                padding:
                    18px 18px 100px;

            }


            #${HERO_ID}{

                height:
                    290px;

            }


            .neos-hero-title{

                font-size:
                    34px;

            }

        }


        /* =================================================
           REDUCED MOTION
           ================================================= */

        @media(prefers-reduced-motion:reduce){

            *,
            *::before,
            *::after{

                animation-duration:
                    .01ms !important;

                transition-duration:
                    .01ms !important;

            }

        }

        `;

        document.head.appendChild(style);

    }


    /* =====================================================
       SIGMA LOGO
       ===================================================== */

    function addSigmaLogo(){

        const heading =
            document.querySelector(
                ".app-header h1"
            );

        if(!heading){
            return;
        }


        if(
            document.getElementById(
                LOGO_ID
            )
        ){
            return;
        }


        const logo =
            document.createElement(
                "span"
            );

        logo.id =
            LOGO_ID;


        const letter =
            document.createElement(
                "span"
            );

        letter.textContent =
            "N";


        logo.appendChild(
            letter
        );


        heading.prepend(
            logo
        );

    }


    /* =====================================================
       HERO
       ===================================================== */

    function addSigmaHero(){

        const home =
            document.getElementById(
                "homeSection"
            );

        if(!home){
            return;
        }


        if(
            document.getElementById(
                HERO_ID
            )
        ){
            return;
        }


        const progress =
            home.querySelector(
                ".progress-card"
            );


        if(!progress){
            return;
        }


        const hero =
            document.createElement(
                "section"
            );

        hero.id =
            HERO_ID;

        hero.setAttribute(
            "aria-label",
            "NEET OS Motivation"
        );


        const captions = [

            [
                "FOCUS MODE",
                "DISCIPLINE.",
                "Your future is built in the hours nobody sees."
            ],

            [
                "NO EXCUSES",
                "STAY SHARP.",
                "One session. One chapter. One step closer."
            ],

            [
                "THE MISSION",
                "DOCTOR TOMORROW.",
                "Today's discipline becomes tomorrow's identity."
            ],

            [
                "LOCK IN",
                "KEEP GOING.",
                "You don't need motivation. You need consistency."
            ]

        ];


        USER_PHOTOS.forEach(
            (src,index)=>{

                if(
                    !src ||
                    src.includes(
                        "PASTE_PHOTO"
                    )
                ){
                    return;
                }


                const slide =
                    document.createElement(
                        "div"
                    );

                slide.className =
                    "neos-hero-slide";


                if(index === 0){

                    slide.classList.add(
                        "active"
                    );

                }


                const img =
                    document.createElement(
                        "img"
                    );

                img.src =
                    src;

                img.alt =
                    "";

                img.loading =
                    index === 0
                        ? "eager"
                        : "lazy";


                const copy =
                    document.createElement(
                        "div"
                    );

                copy.className =
                    "neos-hero-copy";


                copy.innerHTML = `

                    <div class="neos-hero-kicker">
                        ${captions[index][0]}
                    </div>

                    <div class="neos-hero-title">
                        ${captions[index][1]}
                    </div>

                    <div class="neos-hero-sub">
                        ${captions[index][2]}
                    </div>

                `;


                slide.append(
                    img,
                    copy
                );


                hero.appendChild(
                    slide
                );

            }
        );


        const dots =
            document.createElement(
                "div"
            );

        dots.className =
            "neos-dots";


        const slides =
            hero.querySelectorAll(
                ".neos-hero-slide"
            );


        slides.forEach(
            (_,index)=>{

                const dot =
                    document.createElement(
                        "span"
                    );

                dot.className =
                    "neos-dot";


                if(index === 0){

                    dot.classList.add(
                        "active"
                    );

                }


                dots.appendChild(
                    dot
                );

            }
        );


        hero.appendChild(
            dots
        );


        const schedule =
            home.querySelector(
                ".schedule-section"
            );


        if(schedule){

            home.insertBefore(
                hero,
                schedule
            );

        }else{

            progress.after(
                hero
            );

        }

    }


    /* =====================================================
       HERO ROTATION
       ===================================================== */

    function rotateHero(){

        const hero =
            document.getElementById(
                HERO_ID
            );

        if(!hero){
            return;
        }


        const slides =
            hero.querySelectorAll(
                ".neos-hero-slide"
            );

        const dots =
            hero.querySelectorAll(
                ".neos-dot"
            );


        if(
            slides.length < 2
        ){
            return;
        }


        heroIndex =
            (heroIndex + 1)
            % slides.length;


        slides.forEach(
            (slide,index)=>{

                slide.classList.toggle(
                    "active",
                    index === heroIndex
                );

            }
        );


        dots.forEach(
            (dot,index)=>{

                dot.classList.toggle(
                    "active",
                    index === heroIndex
                );

            }
        );

    }


    /* =====================================================
       ACTIVE TASK
       ===================================================== */

    function updateActiveTaskUI(){

        try{

            if(
                typeof data ===
                "undefined" ||
                !data
            ){
                return;
            }


            const active =
                data.activeTask;


            if(
                active ===
                lastActiveTask
            ){
                return;
            }


            lastActiveTask =
                active;


            document
                .querySelectorAll(
                    ".task-card"
                )
                .forEach(
                    (card,index)=>{

                        const isActive =
                            index === active;


                        card.classList.toggle(
                            "neos-active",
                            isActive
                        );


                        let pill =
                            card.querySelector(
                                ".neos-now-pill"
                            );


                        if(
                            isActive
                        ){

                            if(!pill){

                                const info =
                                    card.querySelector(
                                        ".task-info"
                                    );


                                if(info){

                                    pill =
                                        document.createElement(
                                            "div"
                                        );

                                    pill.className =
                                        "neos-now-pill";

                                    pill.textContent =
                                        "LIVE NOW";

                                    info.appendChild(
                                        pill
                                    );

                                }

                            }

                        }else{

                            if(pill){

                                pill.remove();

                            }

                        }

                    }
                );

        }catch(error){

            console.warn(
                "NEET OS Sigma UI task visual error:",
                error
            );

        }

    }


    /* =====================================================
       PAGE ACCENT
       ===================================================== */

    function updatePageAccent(){

        const page =
            document
                .querySelector(
                    ".app-page.active-page"
                )
                ?.getAttribute(
                    "data-section"
                ) ||
                "";


        if(
            page === lastPage
        ){
            return;
        }


        lastPage =
            page;


        document.body.dataset.neetosPage =
            page;

    }


    /* =====================================================
       INITIALIZE
       ===================================================== */

    function initialize(){

        installPremiumStyle();

        addSigmaLogo();

        addSigmaHero();

        updateActiveTaskUI();

        updatePageAccent();


        /*
         * Lightweight visual refresh only.
         */

        setInterval(
            ()=>{
                addSigmaLogo();
                addSigmaHero();
                updateActiveTaskUI();
                updatePageAccent();
            },
            1000
        );


        /*
         * Photo rotation.
         */

        setInterval(
            rotateHero,
            7000
        );


        console.log(
            "🔥 NEET OS — Dibyendu Sigma Premium UI loaded."
        );

    }


    /* =====================================================
       START
       ===================================================== */

    if(
        document.readyState ===
        "loading"
    ){

        document.addEventListener(
            "DOMContentLoaded",
            initialize,
            {
                once:true
            }
        );

    }else{

        setTimeout(
            initialize,
            200
        );

    }


    /* =====================================================
       PUBLIC API
       ===================================================== */

    window.NEETOSDibyenduSigmaUI = {

        version:
            "1.0.0",

        refresh:
            ()=>{
                addSigmaLogo();
                addSigmaHero();
                updateActiveTaskUI();
                updatePageAccent();
            },

        nextPhoto:
            ()=>{
                rotateHero();
            }

    };

})();
/* =========================================================
   NEET OS — SIGMA UI BLANK SPACE FINAL FIX
   Version: 2.0.0

   FIX:
   ✓ Removes empty/blank Sigma hero container
   ✓ Restores Progress card content
   ✓ Restores Progress ring
   ✓ Restores Progress details
   ✓ Keeps premium UI
   ✓ Keeps user's photos if properly loaded
   ✓ Does NOT touch study logic
   ✓ Does NOT touch timer
   ✓ Does NOT touch Firebase
   ✓ Does NOT touch storage
========================================================= */

(function NEETOS_SIGMA_BLANK_SPACE_FINAL_FIX(){

    "use strict";

    if(window.__NEETOS_SIGMA_BLANK_SPACE_FINAL_FIX_V2){
        return;
    }

    window.__NEETOS_SIGMA_BLANK_SPACE_FINAL_FIX_V2 = true;


    /* =====================================================
       1. FINAL CSS
    ===================================================== */

    const style =
        document.createElement("style");

    style.id =
        "neetosSigmaBlankSpaceFinalFix";


    style.textContent = `

        /* =================================================
           MAIN CONTENT
        ================================================= */

        #mainContent{

            width:100% !important;

            max-width:900px !important;

            margin:0 auto !important;

            padding:
                18px 14px 105px !important;

            box-sizing:border-box !important;

        }


        /* =================================================
           HOME
        ================================================= */

        #homeSection{

            width:100% !important;

            min-height:0 !important;

        }


        /* =================================================
           IMPORTANT:
           REMOVE EMPTY SIGMA HERO

           If the previous addon created the hero but
           photos did not load, it must NOT leave a giant
           blank box.
        ================================================= */

        #neetosSigmaHero{

            height:0 !important;

            min-height:0 !important;

            margin:0 !important;

            padding:0 !important;

            border:0 !important;

            box-shadow:none !important;

            background:transparent !important;

            overflow:hidden !important;

        }


        #neetosSigmaHero .neos-hero-slide,
        #neetosSigmaHero .neos-dots{

            display:none !important;

        }


        /* =================================================
           ORIGINAL PROGRESS CARD
        ================================================= */

        #homeSection > .progress-card{

            display:flex !important;

            align-items:center !important;

            gap:30px !important;

            width:100% !important;

            min-height:0 !important;

            height:auto !important;

            max-height:none !important;

            box-sizing:border-box !important;

            overflow:visible !important;

        }


        /* =================================================
           PROGRESS RING
        ================================================= */

        #homeSection .progress-card .progress-ring{

            flex:
                0 0 150px !important;

            width:
                150px !important;

            height:
                150px !important;

            min-width:
                150px !important;

            min-height:
                150px !important;

            max-width:
                150px !important;

            max-height:
                150px !important;

            display:flex !important;

            align-items:center !important;

            justify-content:center !important;

            position:relative !important;

            visibility:visible !important;

            opacity:1 !important;

        }


        /* =================================================
           RING INNER
        ================================================= */

        #homeSection .progress-ring-inner{

            display:flex !important;

            visibility:visible !important;

            opacity:1 !important;

            position:relative !important;

            z-index:5 !important;

        }


        #homeSection
        .progress-ring-inner strong{

            display:block !important;

            visibility:visible !important;

            opacity:1 !important;

        }


        #homeSection
        .progress-ring-inner span{

            display:block !important;

            visibility:visible !important;

            opacity:1 !important;

        }


        /* =================================================
           PROGRESS DETAILS
        ================================================= */

        #homeSection .progress-details{

            display:block !important;

            flex:1 1 auto !important;

            min-width:0 !important;

            visibility:visible !important;

            opacity:1 !important;

        }


        #homeSection .progress-details .stat-row{

            display:flex !important;

            align-items:center !important;

            justify-content:space-between !important;

            width:100% !important;

        }


        #homeSection .progress-details
        .progress-line{

            display:block !important;

            width:100% !important;

        }


        /* =================================================
           PROGRESS HEADER
        ================================================= */

        #homeSection .progress-card
        .card-header{

            display:flex !important;

            align-items:center !important;

            justify-content:space-between !important;

            gap:15px !important;

        }


        #homeSection .progress-card
        .card-header > div{

            display:block !important;

        }


        /* =================================================
           DESKTOP
        ================================================= */

        @media(min-width:701px){

            #mainContent{

                max-width:
                    900px !important;

            }


            #homeSection
            .progress-card{

                flex-direction:
                    row !important;

            }

        }


        /* =================================================
           MOBILE
        ================================================= */

        @media(max-width:700px){

            #mainContent{

                padding:
                    12px 11px 100px !important;

            }


            #homeSection
            .progress-card{

                flex-direction:
                    column !important;

                align-items:
                    stretch !important;

                gap:
                    18px !important;

                padding:
                    16px !important;

            }


            #homeSection
            .progress-card
            .card-header{

                width:
                    100% !important;

            }


            #homeSection
            .progress-card
            .progress-ring{

                align-self:
                    center !important;

                width:
                    145px !important;

                height:
                    145px !important;

                min-width:
                    145px !important;

                min-height:
                    145px !important;

            }


            #homeSection
            .progress-details{

                width:
                    100% !important;

            }

        }


        /* =================================================
           SMALL PHONES
        ================================================= */

        @media(max-width:380px){

            #homeSection
            .progress-card
            .progress-ring{

                width:
                    130px !important;

                height:
                    130px !important;

                min-width:
                    130px !important;

                min-height:
                    130px !important;

            }

        }

    `;


    document.head.appendChild(style);


    /* =====================================================
       2. REMOVE ONLY EMPTY HERO
    ===================================================== */

    function removeEmptyHero(){

        const hero =
            document.getElementById(
                "neetosSigmaHero"
            );

        if(!hero){
            return;
        }


        /*
           If there are no successfully loaded images,
           remove the hero completely.
        */

        const images =
            hero.querySelectorAll(
                "img"
            );


        let usable =
            false;


        images.forEach(
            img=>{

                if(
                    img.complete &&
                    img.naturalWidth > 0
                ){

                    usable = true;

                }

            }
        );


        if(!usable){

            hero.remove();

            return;

        }


        /*
           Even if the old addon has an empty hero,
           keep only if it really contains an image.
        */

        const slides =
            hero.querySelectorAll(
                ".neos-hero-slide"
            );


        if(
            images.length === 0 ||
            slides.length === 0
        ){

            hero.remove();

        }

    }


    /* =====================================================
       3. RESTORE PROGRESS CARD
    ===================================================== */

    function restoreProgress(){

        const home =
            document.getElementById(
                "homeSection"
            );

        if(!home){
            return;
        }


        const progressCard =
            home.querySelector(
                ".progress-card"
            );


        if(!progressCard){
            return;
        }


        progressCard.style.removeProperty(
            "height"
        );

        progressCard.style.removeProperty(
            "min-height"
        );

        progressCard.style.removeProperty(
            "max-height"
        );


        const ring =
            progressCard.querySelector(
                ".progress-ring"
            );


        if(ring){

            ring.style.visibility =
                "visible";

            ring.style.opacity =
                "1";

        }


        const details =
            progressCard.querySelector(
                ".progress-details"
            );


        if(details){

            details.style.visibility =
                "visible";

            details.style.opacity =
                "1";

        }

    }


    /* =====================================================
       4. INITIAL FIX
    ===================================================== */

    function fix(){

        removeEmptyHero();

        restoreProgress();

    }


    fix();


    /* =====================================================
       5. DELAYED FIXES
       Existing app renders Home dynamically.
    ===================================================== */

    setTimeout(
        fix,
        100
    );

    setTimeout(
        fix,
        500
    );

    setTimeout(
        fix,
        1200
    );

    setTimeout(
        fix,
        2500
    );


    /* =====================================================
       6. LIGHT SAFETY LOOP
    ===================================================== */

    setInterval(
        function(){

            removeEmptyHero();

            restoreProgress();

        },
        3000
    );


    /* =====================================================
       PUBLIC API
    ===================================================== */

    window.NEETOSSigmaBlankFix = {

        version:
            "2.0.0",

        refresh:
            fix

    };


    console.log(
        "✅ NEET OS Sigma Blank Space Final Fix v2.0.0 loaded."
    );

})();
/* =========================================================
   NEET OS — PERFECT SMOOTH SCROLL PERFORMANCE FIX
   VERSION: 3.0.0

   FIXES:
   ✓ Removes scroll fighting / jumping
   ✓ Stops forced scroll restoration
   ✓ Keeps normal navigation smooth scroll
   ✓ Pauses heavy task re-render while user scrolls
   ✓ Prevents unnecessary layout work during scrolling
   ✓ Mobile + Desktop optimized
   ✓ No study timer changes
   ✓ No Firebase changes
   ✓ No storage changes
   ✓ No task calculation changes
========================================================= */

(function NEETOS_PERFECT_SMOOTH_SCROLL_FIX(){

    "use strict";

    if(window.__NEETOS_PERFECT_SMOOTH_SCROLL_FIX_V3){
        return;
    }

    window.__NEETOS_PERFECT_SMOOTH_SCROLL_FIX_V3 = true;


    /* =====================================================
       1. SCROLL STATE
    ===================================================== */

    let userIsScrolling = false;

    let scrollEndTimer = null;

    let lastScrollTime = 0;

    const SCROLL_IDLE_DELAY = 140;


    function markScrolling(){

        userIsScrolling = true;

        lastScrollTime = performance.now();

        document.documentElement.classList.add(
            "neos-user-scrolling"
        );

        document.body?.classList.add(
            "neos-user-scrolling"
        );


        clearTimeout(scrollEndTimer);


        scrollEndTimer = setTimeout(
            function(){

                userIsScrolling = false;

                document.documentElement.classList.remove(
                    "neos-user-scrolling"
                );

                document.body?.classList.remove(
                    "neos-user-scrolling"
                );


                /*
                   One light refresh after scrolling ends.
                   This lets the app catch up without fighting
                   the user's finger / mouse.
                */

                try{

                    if(
                        typeof updateActiveTimer ===
                        "function"
                    ){
                        updateActiveTimer();
                    }

                    if(
                        typeof updateTaskStatusLabels ===
                        "function"
                    ){
                        updateTaskStatusLabels();
                    }

                }catch(e){}

            },
            SCROLL_IDLE_DELAY
        );

    }


    window.addEventListener(
        "scroll",
        markScrolling,
        {
            passive:true
        }
    );


    window.addEventListener(
        "wheel",
        markScrolling,
        {
            passive:true
        }
    );


    window.addEventListener(
        "touchmove",
        markScrolling,
        {
            passive:true
        }
    );


    window.addEventListener(
        "touchstart",
        markScrolling,
        {
            passive:true
        }
    );


    window.addEventListener(
        "pointermove",
        function(){

            if(
                window.matchMedia(
                    "(pointer: coarse)"
                ).matches
            ){

                markScrolling();

            }

        },
        {
            passive:true
        }
    );


    /* =====================================================
       2. BLOCK ONLY THE OLD FORCED NUMERIC SCROLL
       
       Existing Scroll Stabilizer uses:

           window.scrollTo(0, expectedY)

       Normal navigation uses:

           window.scrollTo({
               top:0,
               behavior:"smooth"
           })

       So we block ONLY the old numeric form.
    ===================================================== */

    const originalScrollTo =
        window.scrollTo.bind(window);


    window.scrollTo =
        function(){

            try{

                /*
                   Numeric 2-argument scrollTo is used by
                   the old Scroll Stabilizer.

                   Do NOT execute it.
                */

                if(
                    arguments.length >= 2 &&
                    typeof arguments[0] === "number" &&
                    typeof arguments[1] === "number"
                ){

                    /*
                       During manual scrolling this is always
                       unwanted scroll fighting.
                    */

                    if(userIsScrolling){

                        return;

                    }


                    /*
                       Also ignore numeric restoration calls
                       from the old stabilizer when it tries to
                       restore an old position after layout change.
                    */

                    return;

                }

            }catch(e){}


            /*
               Object-based smooth scrolling remains untouched.
            */

            return originalScrollTo(
                ...arguments
            );

        };


    /* =====================================================
       3. WRAP renderTasks SAFELY
       
       Existing renderTasks can rebuild task cards every
       second. During active scrolling we temporarily skip it.
    ===================================================== */

    let originalRenderTasks = null;

    let renderTasksWrapped = false;


    function installRenderShield(){

        if(
            renderTasksWrapped
        ){
            return;
        }


        if(
            typeof window.renderTasks !==
            "function"
        ){

            /*
               In this app renderTasks may be a lexical
               function rather than window property.
               Retry later.
            */

            return;

        }


        originalRenderTasks =
            window.renderTasks;


        window.renderTasks =
            function(){

                if(userIsScrolling){

                    return;

                }


                return originalRenderTasks.apply(
                    this,
                    arguments
                );

            };


        renderTasksWrapped = true;

    }


    /*
       Try several times because the core app may initialise
       after this addon.
    */

    installRenderShield();


    setTimeout(
        installRenderShield,
        100
    );

    setTimeout(
        installRenderShield,
        500
    );

    setTimeout(
        installRenderShield,
        1200
    );


    /* =====================================================
       4. CSS SCROLL PERFORMANCE
    ===================================================== */

    const style =
        document.createElement(
            "style"
        );


    style.id =
        "neetosPerfectSmoothScrollFix";


    style.textContent = `

        /*
           Never create horizontal scrolling.
        */

        html,
        body{

            max-width:100% !important;

            overflow-x:hidden !important;

        }


        /*
           Keep normal vertical browser scrolling.
        */

        html{

            overflow-y:auto !important;

            /*
               Smooth only for programmatic navigation.
               User wheel/touch scrolling remains native.
            */

            scroll-behavior:auto !important;

        }


        body{

            overflow-y:auto !important;

            overscroll-behavior-x:none !important;

            -webkit-overflow-scrolling:touch !important;

        }


        /*
           Don't allow text/image selection to create
           accidental drag behaviour on UI controls.
        */

        button,
        .icon-button,
        .start-button,
        .nav-item{

            touch-action:manipulation !important;

        }


        /*
           Avoid expensive visual work while scrolling.
        */

        .neos-user-scrolling
        .task-card{

            transition:none !important;

        }


        .neos-user-scrolling
        .simple-card{

            transition:none !important;

        }


        .neos-user-scrolling
        .card{

            transition:none !important;

        }


        /*
           Don't let dynamically changing sections
           participate in browser scroll anchoring.
        */

        #statsSection,
        #neetosFinalUnifiedAnalytics,
        #neetOS30DayPerformance,
        #neetosFinalTestStats,
        #neetosFinalTestAnalysis,
        #neetosTestAnalysis{

            overflow-anchor:none !important;

        }


        /*
           Main page remains a normal native scrolling surface.
        */

        #mainContent{

            overflow:visible !important;

            overscroll-behavior-y:auto !important;

        }


        /*
           MOBILE
        */

        @media(max-width:700px){

            html,
            body{

                width:100% !important;

                max-width:100% !important;

            }


            #mainContent{

                width:100% !important;

                max-width:100% !important;

                box-sizing:border-box !important;

            }

        }

    `;


    document.head.appendChild(
        style
    );


    /* =====================================================
       5. PREVENT ACCIDENTAL FOCUS SCROLL JUMPS
    ===================================================== */

    document.addEventListener(
        "focusin",
        function(event){

            if(!event.target){
                return;
            }


            /*
               Inputs/selects should still work normally.
               We only avoid automatic smooth scrolling
               caused by the browser during active manual
               scrolling.
            */

            if(userIsScrolling){

                try{

                    event.target.scrollIntoView = function(){
                        return;
                    };

                }catch(e){}

            }

        },
        {
            passive:true
        }
    );


    /* =====================================================
       6. EXPOSE STATUS
    ===================================================== */

    window.NEETOSSmoothScrollFix = {

        version:
            "3.0.0",

        isScrolling:
            function(){

                return userIsScrolling;

            },

        refresh:
            function(){

                userIsScrolling = false;

                clearTimeout(
                    scrollEndTimer
                );

                try{

                    if(
                        typeof updateActiveTimer ===
                        "function"
                    ){

                        updateActiveTimer();

                    }

                }catch(e){}

            }

    };


    console.log(
        "✅ NEET OS Perfect Smooth Scroll Fix v3.0.0 loaded."
    );

})();
/* =========================================================
   NEET OS — PREMIUM PERSONAL LOGO
   ========================================================= */

(function(){

    "use strict";

    if(window.__NEETOS_PREMIUM_PERSONAL_LOGO_V1){
        return;
    }

    window.__NEETOS_PREMIUM_PERSONAL_LOGO_V1 = true;

    const STYLE_ID =
        "neetosPremiumPersonalLogoStyle";

    function installStyle(){

        if(document.getElementById(STYLE_ID)){
            return;
        }

        const style =
            document.createElement("style");

        style.id =
            STYLE_ID;

        style.textContent = `

            #neetOSPersonalLogo{

                width:46px !important;
                height:46px !important;

                min-width:46px !important;
                min-height:46px !important;

                object-fit:cover !important;

                display:block !important;

                border-radius:50% !important;

                border:
                    1px solid
                    rgba(255,255,255,.16) !important;

                background:#080808 !important;

                box-shadow:

                    0 0 0 1px
                    rgba(229,9,20,.20),

                    0 7px 25px
                    rgba(229,9,20,.32) !important;

                transition:
                    transform .2s ease,
                    box-shadow .2s ease !important;

            }


            #neetOSPersonalLogo:hover{

                transform:
                    scale(1.05);

                box-shadow:

                    0 0 0 1px
                    rgba(229,9,20,.40),

                    0 9px 32px
                    rgba(229,9,20,.45) !important;

            }


            @media(max-width:600px){

                #neetOSPersonalLogo{

                    width:42px !important;
                    height:42px !important;

                    min-width:42px !important;
                    min-height:42px !important;

                }

            }

        `;

        document.head.appendChild(style);

    }


    function installLogo(){

        const headerLeft =
            document.querySelector(
                ".app-header .header-left"
            );

        if(!headerLeft){
            return;
        }


        if(
            document.getElementById(
                "neetOSPersonalLogo"
            )
        ){

            return;

        }


        const title =
            headerLeft.querySelector("h1");

        if(!title){
            return;
        }


        const img =
            document.createElement("img");


        img.id =
            "neetOSPersonalLogo";


        img.src =
            "./assets/neet-os-header-icon.png";


        img.alt =
            "NEET OS";


        img.width =
            46;

        img.height =
            46;


        /*
         * Put the new premium logo
         * before the existing NEET OS title.
         */

        headerLeft.insertBefore(
            img,
            title
        );

    }


    function init(){

        installStyle();

        installLogo();

    }


    if(
        document.readyState ===
        "loading"
    ){

        document.addEventListener(
            "DOMContentLoaded",
            init,
            {once:true}
        );

    }else{

        init();

    }


    setTimeout(
        init,
        300
    );

    setTimeout(
        init,
        1000
    );


    console.log(
        "🔥 NEET OS Premium Personal Logo loaded."
    );

})();
/* =========================================================
   NEET OS — PREMIUM PERSONAL LOGO FINAL FIX
   Version 2.0.0

   FIXES:
   ✓ Fixes insertBefore DOM error
   ✓ Correctly places logo in header
   ✓ Uses assets/neet-os-header-icon.png
   ✓ Does NOT touch study logic
   ✓ Does NOT touch timer
   ✓ Does NOT touch Firebase
   ✓ Does NOT touch storage
========================================================= */

(function NEETOS_PREMIUM_LOGO_FINAL_FIX(){

    "use strict";

    if(window.__NEETOS_PREMIUM_LOGO_FINAL_FIX_V2){
        return;
    }

    window.__NEETOS_PREMIUM_LOGO_FINAL_FIX_V2 = true;


    /* =====================================================
       STYLE
    ===================================================== */

    const STYLE_ID =
        "neetosPremiumLogoFinalStyle";


    if(!document.getElementById(STYLE_ID)){

        const style =
            document.createElement("style");

        style.id =
            STYLE_ID;

        style.textContent = `

            #neetOSPersonalLogoFinal{

                width:46px !important;
                height:46px !important;

                min-width:46px !important;
                min-height:46px !important;

                flex:0 0 46px !important;

                display:block !important;

                object-fit:cover !important;

                border-radius:50% !important;

                background:#080808 !important;

                border:
                    1px solid
                    rgba(255,255,255,.15) !important;

                box-shadow:

                    0 0 0 1px
                    rgba(229,9,20,.20),

                    0 6px 24px
                    rgba(229,9,20,.32) !important;

            }


            .neos-personal-logo-wrap{

                display:flex !important;

                align-items:center !important;

                justify-content:center !important;

                flex:0 0 auto !important;

            }


            @media(max-width:600px){

                #neetOSPersonalLogoFinal{

                    width:42px !important;
                    height:42px !important;

                    min-width:42px !important;
                    min-height:42px !important;

                    flex-basis:42px !important;

                }

            }

        `;

        document.head.appendChild(style);

    }


    /* =====================================================
       INSTALL
    ===================================================== */

    function installLogo(){

        /*
         * Already installed
         */

        if(
            document.getElementById(
                "neetOSPersonalLogoFinal"
            )
        ){

            return true;

        }


        /*
         * Find actual header.
         */

        const headerLeft =
            document.querySelector(
                ".app-header .header-left"
            );


        if(!headerLeft){

            return false;

        }


        /*
         * Find the existing title.
         */

        const title =
            headerLeft.querySelector(
                "h1"
            );


        if(!title){

            return false;

        }


        /*
         * IMPORTANT:
         *
         * title may be inside another element.
         *
         * Therefore DON'T do:
         *
         * headerLeft.insertBefore(img,title)
         *
         * unless title is actually a direct child.
         */

        const wrapper =
            document.createElement(
                "div"
            );

        wrapper.className =
            "neos-personal-logo-wrap";


        const img =
            document.createElement(
                "img"
            );


        img.id =
            "neetOSPersonalLogoFinal";


        img.src =
            "./assets/neet-os-header-icon.png";


        img.alt =
            "NEET OS";


        img.width =
            46;


        img.height =
            46;


        /*
         * Add image into wrapper.
         */

        wrapper.appendChild(
            img
        );


        /*
         * Safest placement:
         *
         * Put wrapper at the beginning of the
         * actual header-left container.
         *
         * No invalid insertBefore operation.
         */

        headerLeft.prepend(
            wrapper
        );


        return true;

    }


    /* =====================================================
       INITIALIZE
    ===================================================== */

    function initLogo(){

        try{

            installLogo();

        }catch(error){

            console.warn(
                "NEET OS Premium Logo:",
                error
            );

        }

    }


    if(
        document.readyState ===
        "loading"
    ){

        document.addEventListener(
            "DOMContentLoaded",
            initLogo,
            {once:true}
        );

    }else{

        initLogo();

    }


    /*
     * Small delayed retries because the main app can
     * finish rendering after DOMContentLoaded.
     */

    setTimeout(
        initLogo,
        250
    );

    setTimeout(
        initLogo,
        800
    );

    setTimeout(
        initLogo,
        1500
    );


    console.log(
        "✅ NEET OS Premium Personal Logo Final Fix v2.0.0 loaded."
    );

})();
/* =========================================================
   NEET OS — FINAL LOGO + ICON ERROR SHIELD
   Version 3.0.0

   APPEND ONLY

   ✓ No existing code deletion
   ✓ No existing function replacement
   ✓ Fixes old insertBefore DOM error
   ✓ Removes duplicate old logo
   ✓ Keeps premium personal logo
   ✓ Fixes favicon path
   ✓ Fixes manifest icon path at runtime
   ✓ No Firebase changes
   ✓ No storage changes
   ✓ No study/timer changes
========================================================= */

(function NEETOS_FINAL_LOGO_ICON_ERROR_SHIELD(){

    "use strict";

    if(window.__NEETOS_FINAL_LOGO_ICON_ERROR_SHIELD_V3){
        return;
    }

    window.__NEETOS_FINAL_LOGO_ICON_ERROR_SHIELD_V3 = true;


    /* =====================================================
       CONFIG
    ===================================================== */

    const FINAL_LOGO_ID =
        "neetOSPersonalLogoFinal";

    const OLD_LOGO_ID =
        "neetOSPersonalLogo";

    const LOGO_PATH =
        "./assets/neet-os-header-icon.png";

    const FAVICON_PATH =
        "./assets/favicon.ico";

    const MANIFEST_ICON_PATH =
        "./icons/icon-192.png";


    /* =====================================================
       1. SAFE insertBefore SHIELD
       -----------------------------------------------------
       Old addon does:

       headerLeft.insertBefore(img,title)

       But title is NOT a direct child of headerLeft.

       This catches ONLY that specific logo operation.
       Nothing else is affected.
    ===================================================== */

    const originalInsertBefore =
        Node.prototype.insertBefore;


    if(!window.__NEETOS_SAFE_INSERT_BEFORE_V3){

        window.__NEETOS_SAFE_INSERT_BEFORE_V3 = true;


        Node.prototype.insertBefore =
            function(newNode, referenceNode){

                try{

                    /*
                     * Only intercept the old broken logo.
                     */

                    if(
                        newNode &&
                        newNode.nodeType === 1 &&
                        newNode.id === OLD_LOGO_ID &&
                        referenceNode &&
                        referenceNode.parentNode !== this
                    ){

                        /*
                         * Put old logo safely at the beginning.
                         */

                        return this.insertBefore(
                            newNode,
                            this.firstChild
                        );

                    }

                }catch(e){

                    /*
                     * Continue to original browser behaviour
                     * for anything unexpected.
                     */

                }


                return originalInsertBefore.call(
                    this,
                    newNode,
                    referenceNode
                );

            };

    }


    /* =====================================================
       2. REMOVE OLD DUPLICATE LOGO
       -----------------------------------------------------
       The old addon can still create its own logo.
       We keep ONLY the final logo.
    ===================================================== */

    function removeOldLogo(){

        document
            .querySelectorAll(
                "#" + OLD_LOGO_ID
            )
            .forEach(
                el => {

                    /*
                     * Never touch our final logo.
                     */

                    if(
                        el.id !== FINAL_LOGO_ID
                    ){

                        el.remove();

                    }

                }
            );

    }


    /* =====================================================
       3. INSTALL FINAL LOGO
    ===================================================== */

    function installFinalLogo(){

        const headerLeft =
            document.querySelector(
                ".app-header .header-left"
            );


        if(!headerLeft){

            return;

        }


        /*
         * If final logo already exists, leave it alone.
         */

        if(
            document.getElementById(
                FINAL_LOGO_ID
            )
        ){

            removeOldLogo();

            return;

        }


        const title =
            headerLeft.querySelector(
                "h1"
            );


        if(!title){

            return;

        }


        const logo =
            document.createElement(
                "img"
            );


        logo.id =
            FINAL_LOGO_ID;


        logo.src =
            LOGO_PATH;


        logo.alt =
            "NEET OS";


        logo.width =
            46;


        logo.height =
            46;


        logo.loading =
            "eager";


        logo.decoding =
            "async";


        /*
         * SAFE insertion.
         *
         * No insertBefore(referenceNode) problem.
         */

        headerLeft.prepend(
            logo
        );


        removeOldLogo();

    }


    /* =====================================================
       4. PREMIUM LOGO CSS
    ===================================================== */

    function installLogoStyle(){

        const STYLE_ID =
            "neetosFinalLogoShieldStyle";


        if(
            document.getElementById(
                STYLE_ID
            )
        ){

            return;

        }


        const style =
            document.createElement(
                "style"
            );


        style.id =
            STYLE_ID;


        style.textContent = `

            #${FINAL_LOGO_ID}{

                width:
                    46px !important;

                height:
                    46px !important;

                min-width:
                    46px !important;

                min-height:
                    46px !important;

                flex:
                    0 0 46px !important;

                display:
                    block !important;

                object-fit:
                    cover !important;

                border-radius:
                    50% !important;

                border:
                    1px solid
                    rgba(255,255,255,.14) !important;

                background:
                    #080808 !important;

                box-shadow:

                    0 0 0 1px
                    rgba(229,9,20,.18),

                    0 7px 25px
                    rgba(229,9,20,.32) !important;

                pointer-events:
                    none !important;

            }


            @media(max-width:600px){

                #${FINAL_LOGO_ID}{

                    width:
                        42px !important;

                    height:
                        42px !important;

                    min-width:
                        42px !important;

                    min-height:
                        42px !important;

                    flex-basis:
                        42px !important;

                }

            }

        `;


        document.head.appendChild(
            style
        );

    }


    /* =====================================================
       5. FAVICON FIX
       -----------------------------------------------------
       Browser was requesting:

       /favicon.ico

       Actual file:

       /assets/favicon.ico
    ===================================================== */

    function installFavicon(){

        let favicon =
            document.querySelector(
                'link[rel="icon"]'
            );


        if(!favicon){

            favicon =
                document.createElement(
                    "link"
                );

            favicon.rel =
                "icon";

            document.head.appendChild(
                favicon
            );

        }


        favicon.href =
            FAVICON_PATH;


        favicon.type =
            "image/x-icon";


        /*
         * Also handle shortcut icon.
         */

        let shortcut =
            document.querySelector(
                'link[rel="shortcut icon"]'
            );


        if(!shortcut){

            shortcut =
                document.createElement(
                    "link"
                );

            shortcut.rel =
                "shortcut icon";

            document.head.appendChild(
                shortcut
            );

        }


        shortcut.href =
            FAVICON_PATH;

    }


    /* =====================================================
       6. MANIFEST ICON FIX
       -----------------------------------------------------
       Existing manifest points to:

       /icons/icon-192.png

       We create a corrected runtime manifest
       without editing manifest.json.
    ===================================================== */

    function installRuntimeManifest(){

        const existing =
            document.querySelector(
                'link[rel="manifest"]'
            );


        if(!existing){

            return;

        }


        /*
         * Prevent creating multiple runtime manifests.
         */

        if(
            window.__NEETOS_RUNTIME_MANIFEST_V3
        ){

            return;

        }


        window.__NEETOS_RUNTIME_MANIFEST_V3 =
            true;


        try{

            const manifest = {

                name:
                    "NEET OS",

                short_name:
                    "NEET OS",

                start_url:
                    "./index.html",

                display:
                    "standalone",

                background_color:
                    "#050505",

                theme_color:
                    "#e50914",

                icons:[
                    {
                        src:
                            MANIFEST_ICON_PATH,

                        sizes:
                            "192x192",

                        type:
                            "image/png"
                    },

                    {
                        src:
                            "./assets/neet-os-logo-512.png",

                        sizes:
                            "512x512",

                        type:
                            "image/png"
                    }
                ]

            };


            const blob =
                new Blob(
                    [
                        JSON.stringify(
                            manifest
                        )
                    ],
                    {
                        type:
                            "application/manifest+json"
                    }
                );


            const url =
                URL.createObjectURL(
                    blob
                );


            existing.href =
                url;


        }catch(error){

            console.warn(
                "NEET OS runtime manifest fix skipped:",
                error
            );

        }

    }


    /* =====================================================
       7. RUN EVERYTHING
    ===================================================== */

    function finalFix(){

        try{

            installLogoStyle();

            installFinalLogo();

            removeOldLogo();

            installFavicon();

            installRuntimeManifest();

        }catch(error){

            console.warn(
                "NEET OS Logo/Icon Shield:",
                error
            );

        }

    }


    /* =====================================================
       INITIAL
    ===================================================== */

    if(
        document.readyState ===
        "loading"
    ){

        document.addEventListener(
            "DOMContentLoaded",
            finalFix,
            {
                once:true
            }
        );

    }else{

        finalFix();

    }


    /* =====================================================
       DELAYED STARTUP CHECKS
    ===================================================== */

    setTimeout(
        finalFix,
        100
    );

    setTimeout(
        finalFix,
        500
    );

    setTimeout(
        finalFix,
        1200
    );

    setTimeout(
        finalFix,
        2500
    );


    /* =====================================================
       LIGHT DUPLICATE CLEANUP
       -----------------------------------------------------
       Does NOT rebuild UI.
    ===================================================== */

    setInterval(
        function(){

            removeOldLogo();

            if(
                !document.getElementById(
                    FINAL_LOGO_ID
                )
            ){

                installFinalLogo();

            }

        },
        2000
    );


    /* =====================================================
       PUBLIC API
    ===================================================== */

    window.NEETOSFinalLogoIconShield = {

        version:
            "3.0.0",

        refresh:
            finalFix

    };


    console.log(
        "🔥 NEET OS Final Logo + Icon Error Shield v3.0.0 loaded."
    );

})();
/* =========================================================
   NEET OS — DUPLICATE LOGO + OLD INSERTBEFORE FINAL SHIELD
   Version 4.0.0

   APPEND ONLY

   ✓ Existing code untouched
   ✓ Existing addons untouched
   ✓ Prevents duplicate-logo blink
   ✓ Keeps ONLY final premium logo visible
   ✓ Fixes old invalid insertBefore logo operation
   ✓ No Firebase changes
   ✓ No storage changes
   ✓ No timer changes
   ✓ No study logic changes
========================================================= */

(function NEETOS_DUPLICATE_LOGO_FINAL_SHIELD(){

    "use strict";

    if(window.__NEETOS_DUPLICATE_LOGO_FINAL_SHIELD_V4){
        return;
    }

    window.__NEETOS_DUPLICATE_LOGO_FINAL_SHIELD_V4 = true;


    const FINAL_ID =
        "neetOSPersonalLogoFinal";

    const LOGO_SRC =
        "neet-os-header-icon.png";


    /* =====================================================
       1. CSS — HIDE OLD LOGOS IMMEDIATELY
       -----------------------------------------------------
       This is the important part for the blink.

       Any logo image inside header-left is hidden.
       Our final logo is explicitly shown.
    ===================================================== */

    const STYLE_ID =
        "neetosDuplicateLogoFinalShieldStyle";


    if(!document.getElementById(STYLE_ID)){

        const style =
            document.createElement("style");

        style.id =
            STYLE_ID;

        style.textContent = `

            /*
             * Hide every image inside the header-left
             * by default.
             *
             * This prevents the old logo addon from
             * appearing even for a fraction of a second.
             */

            .app-header .header-left img{

                display:none !important;

                visibility:hidden !important;

                opacity:0 !important;

            }


            /*
             * ONLY our final logo is visible.
             */

            .app-header .header-left
            #${FINAL_ID}{

                display:block !important;

                visibility:visible !important;

                opacity:1 !important;

            }


            /*
             * Premium appearance.
             */

            #${FINAL_ID}{

                width:46px !important;

                height:46px !important;

                min-width:46px !important;

                min-height:46px !important;

                flex:0 0 46px !important;

                object-fit:cover !important;

                border-radius:50% !important;

                background:#070707 !important;

                border:
                    1px solid
                    rgba(255,255,255,.14) !important;

                box-shadow:

                    0 0 0 1px
                    rgba(229,9,20,.20),

                    0 7px 25px
                    rgba(229,9,20,.32) !important;

                pointer-events:none !important;

            }


            @media(max-width:600px){

                #${FINAL_ID}{

                    width:42px !important;

                    height:42px !important;

                    min-width:42px !important;

                    min-height:42px !important;

                    flex-basis:42px !important;

                }

            }

        `;

        document.head.appendChild(style);

    }


    /* =====================================================
       2. SAFE LOGO DETECTION
    ===================================================== */

    function isOldLogo(node){

        if(!node){
            return false;
        }


        if(
            node.nodeType !== 1
        ){
            return false;
        }


        if(
            node.id === FINAL_ID
        ){
            return false;
        }


        const tag =
            node.tagName ?
            node.tagName.toLowerCase() :
            "";


        if(tag !== "img"){
            return false;
        }


        const src =
            String(
                node.getAttribute("src") || ""
            ).toLowerCase();


        const alt =
            String(
                node.getAttribute("alt") || ""
            ).toLowerCase();


        /*
         * Detect our personal logo by filename.
         */

        return (
            src.includes(
                LOGO_SRC.toLowerCase()
            ) ||
            alt === "neet os"
        );

    }


    /* =====================================================
       3. REMOVE OLD DUPLICATES
    ===================================================== */

    function cleanDuplicateLogos(){

        const headerLeft =
            document.querySelector(
                ".app-header .header-left"
            );


        if(!headerLeft){
            return;
        }


        headerLeft
            .querySelectorAll("img")
            .forEach(
                img => {

                    if(
                        img.id !== FINAL_ID
                    ){

                        /*
                         * Only remove probable old logo.
                         */

                        if(
                            isOldLogo(img)
                        ){

                            img.remove();

                        }

                    }

                }
            );

    }


    /* =====================================================
       4. ENSURE FINAL LOGO EXISTS
    ===================================================== */

    function ensureFinalLogo(){

        const headerLeft =
            document.querySelector(
                ".app-header .header-left"
            );


        if(!headerLeft){
            return;
        }


        let logo =
            document.getElementById(
                FINAL_ID
            );


        if(
            !logo
        ){

            logo =
                document.createElement(
                    "img"
                );


            logo.id =
                FINAL_ID;


            logo.src =
                "./assets/neet-os-header-icon.png";


            logo.alt =
                "NEET OS";


            logo.width =
                46;


            logo.height =
                46;


            logo.loading =
                "eager";


            logo.decoding =
                "async";


            /*
             * Safe insertion.
             */

            headerLeft.prepend(
                logo
            );

        }


        /*
         * Force the final logo to stay visible.
         */

        logo.style.display =
            "block";


        logo.style.visibility =
            "visible";


        logo.style.opacity =
            "1";


        cleanDuplicateLogos();

    }


    /* =====================================================
       5. TARGETED insertBefore PROTECTION
       -----------------------------------------------------
       The old addon does an invalid:

       parent.insertBefore(img,title)

       when title isn't a direct child.

       We only repair IMG/logo operations.
       Normal DOM insertBefore remains untouched.
    ===================================================== */

    if(
        !window.__NEETOS_LOGO_INSERTBEFORE_SHIELD_V4
    ){

        window.__NEETOS_LOGO_INSERTBEFORE_SHIELD_V4 =
            true;


        const nativeInsertBefore =
            Node.prototype.insertBefore;


        Node.prototype.insertBefore =
            function(newNode, referenceNode){

                try{

                    /*
                     * Only intervene for an IMG that looks
                     * like the old NEET OS logo.
                     */

                    if(
                        newNode &&
                        newNode.nodeType === 1 &&
                        newNode.tagName &&
                        newNode.tagName.toLowerCase() === "img" &&
                        newNode.id !== FINAL_ID &&
                        isOldLogo(newNode) &&
                        referenceNode &&
                        referenceNode.parentNode !== this
                    ){

                        /*
                         * Safely append it.
                         *
                         * CSS hides it immediately.
                         *
                         * Therefore the old addon can finish
                         * without throwing NotFoundError.
                         */

                        return this.appendChild(
                            newNode
                        );

                    }

                }catch(error){

                    /*
                     * Never interfere with the rest
                     * of the application.
                     */

                }


                return nativeInsertBefore.call(
                    this,
                    newNode,
                    referenceNode
                );

            };

    }


    /* =====================================================
       6. MUTATION OBSERVER
       -----------------------------------------------------
       Watches ONLY header-left.

       If old addon injects another logo:
       → immediately remove it.
    ===================================================== */

    function observeHeader(){

        const headerLeft =
            document.querySelector(
                ".app-header .header-left"
            );


        if(
            !headerLeft
        ){

            setTimeout(
                observeHeader,
                300
            );

            return;

        }


        if(
            headerLeft.dataset
                .neosLogoShieldObserved ===
            "1"
        ){

            return;

        }


        headerLeft.dataset
            .neosLogoShieldObserved =
            "1";


        const observer =
            new MutationObserver(
                function(){

                    cleanDuplicateLogos();

                    ensureFinalLogo();

                }
            );


        observer.observe(
            headerLeft,
            {
                childList:true,
                subtree:true
            }
        );


        window.NEETOSLogoShieldObserver =
            observer;

    }


    /* =====================================================
       7. INITIALIZE
    ===================================================== */

    function finalLogoFix(){

        try{

            ensureFinalLogo();

            cleanDuplicateLogos();

            observeHeader();

        }catch(error){

            console.warn(
                "NEET OS Logo Shield:",
                error
            );

        }

    }


    if(
        document.readyState ===
        "loading"
    ){

        document.addEventListener(
            "DOMContentLoaded",
            finalLogoFix,
            {
                once:true
            }
        );

    }else{

        finalLogoFix();

    }


    /* =====================================================
       8. STARTUP CHECKS
    ===================================================== */

    setTimeout(
        finalLogoFix,
        50
    );

    setTimeout(
        finalLogoFix,
        150
    );

    setTimeout(
        finalLogoFix,
        400
    );

    setTimeout(
        finalLogoFix,
        1000
    );

    setTimeout(
        finalLogoFix,
        2000
    );


    /* =====================================================
       9. PUBLIC API
    ===================================================== */

    window.NEETOSDuplicateLogoShield = {

        version:
            "4.0.0",

        refresh:
            finalLogoFix,

        clean:
            cleanDuplicateLogos

    };


    console.log(
        "🛡️ NEET OS Duplicate Logo Final Shield v4.0.0 loaded."
    );

})();
/* =========================================================
   NEET OS — FINAL MANIFEST WARNING FIX
   Version 5.0.0

   APPEND ONLY
   ✓ No HTML change
   ✓ No manifest.json change
   ✓ No existing JS deletion
   ✓ Fixes Blob manifest invalid URL warnings
   ✓ Uses absolute URLs
   ✓ Fixes start_url
   ✓ Fixes 192px icon
   ✓ Fixes 512px icon
   ✓ No Firebase / study / timer changes
========================================================= */

(function NEETOS_FINAL_MANIFEST_WARNING_FIX(){

    "use strict";

    if(window.__NEETOS_FINAL_MANIFEST_WARNING_FIX_V5){
        return;
    }

    window.__NEETOS_FINAL_MANIFEST_WARNING_FIX_V5 = true;


    const MANIFEST_LINK =
        document.querySelector(
            'link[rel="manifest"]'
        );


    if(!MANIFEST_LINK){

        console.warn(
            "NEET OS: Manifest link not found."
        );

        return;

    }


    /* =====================================================
       ABSOLUTE URLS
       -----------------------------------------------------
       IMPORTANT:
       Blob manifest cannot safely use "./..."
       relative paths.

       Therefore everything becomes absolute.
    ===================================================== */

    const BASE =
        new URL(
            "./",
            window.location.href
        ).href;


    const START_URL =
        new URL(
            "index.html",
            BASE
        ).href;


    const ICON_192 =
        new URL(
            "assets/neet-os-logo-192.png",
            BASE
        ).href;


    const ICON_512 =
        new URL(
            "assets/neet-os-logo-512.png",
            BASE
        ).href;


    const FAVICON =
        new URL(
            "assets/favicon.ico",
            BASE
        ).href;


    /* =====================================================
       CREATE VALID MANIFEST
    ===================================================== */

    const manifest = {

        name:
            "NEET OS",

        short_name:
            "NEET OS",

        description:
            "NEET preparation study and progress system.",

        start_url:
            START_URL,

        scope:
            BASE,

        display:
            "standalone",

        orientation:
            "portrait",

        background_color:
            "#050505",

        theme_color:
            "#e50914",

        icons: [

            {
                src:
                    ICON_192,

                sizes:
                    "192x192",

                type:
                    "image/png",

                purpose:
                    "any"
            },

            {
                src:
                    ICON_512,

                sizes:
                    "512x512",

                type:
                    "image/png",

                purpose:
                    "any"
            }

        ]

    };


    /* =====================================================
       CONVERT TO BLOB
    ===================================================== */

    try{

        const blob =
            new Blob(
                [
                    JSON.stringify(
                        manifest
                    )
                ],
                {
                    type:
                        "application/manifest+json"
                }
            );


        const manifestURL =
            URL.createObjectURL(
                blob
            );


        /*
         * Replace the manifest URL.
         */

        MANIFEST_LINK.href =
            manifestURL;


        /*
         * Keep the URL available so another addon
         * cannot accidentally garbage-collect it.
         */

        window.__NEETOS_FINAL_MANIFEST_URL_V5 =
            manifestURL;


        /*
         * Also expose the generated manifest for debugging.
         */

        window.__NEETOS_FINAL_MANIFEST_V5 =
            manifest;


        console.log(
            "✅ NEET OS Final Manifest Warning Fix v5.0.0 loaded."
        );

        console.log(
            "NEET OS Manifest:",
            manifest
        );

    }catch(error){

        console.warn(
            "NEET OS Final Manifest Fix failed:",
            error
        );

    }


})();
/* =========================================================
   NEET OS — REAL MANIFEST RESTORE
   Version 6.0.0

   APPEND ONLY
   ✓ Restores original manifest.json
   ✓ Removes Blob manifest usage
   ✓ No HTML change
   ✓ No study logic change
   ✓ No Firebase change
   ✓ No storage change
========================================================= */

(function NEETOS_REAL_MANIFEST_RESTORE(){

    "use strict";

    if(window.__NEETOS_REAL_MANIFEST_RESTORE_V6){
        return;
    }

    window.__NEETOS_REAL_MANIFEST_RESTORE_V6 = true;


    function restoreManifest(){

        const links =
            document.querySelectorAll(
                'link[rel="manifest"]'
            );


        if(!links.length){
            return;
        }


        const realManifest =
            new URL(
                "manifest.json",
                window.location.href
            ).href;


        links.forEach(
            link => {

                if(
                    link.href !==
                    realManifest
                ){

                    link.href =
                        realManifest;

                }

            }
        );

    }


    function fix(){

        try{

            restoreManifest();

        }catch(error){

            console.warn(
                "NEET OS Manifest restore:",
                error
            );

        }

    }


    if(
        document.readyState ===
        "loading"
    ){

        document.addEventListener(
            "DOMContentLoaded",
            fix,
            {once:true}
        );

    }else{

        fix();

    }


    /*
     * The old addon may change it shortly after startup,
     * so perform a few safe restores.
     */

    setTimeout(fix, 0);
    setTimeout(fix, 100);
    setTimeout(fix, 300);
    setTimeout(fix, 700);
    setTimeout(fix, 1500);


    console.log(
        "✅ NEET OS — Real manifest.json restored."
    );

})();
/* =========================================================
   NEET OS — UNIVERSAL SUBJECT + CHAPTER + TOPIC SELECTOR
   ---------------------------------------------------------
   APPEND ONLY
   ---------------------------------------------------------
   ✔ Does NOT replace existing functions
   ✔ Does NOT modify Firebase
   ✔ Does NOT modify Self Study
   ✔ Does NOT modify Daily Repair
   ✔ Normal tasks become:
        SUBJECT → CHAPTER → TOPIC
   ✔ Saves:
        subject
        chapter
        topic
        addonSubject
        addonChapter
        addonActivity
   ✔ Guardian compatible
   ✔ Existing task timer remains untouched
   ========================================================= */

(function NEETOSUniversalTaskContextV1(){

    "use strict";

    if (window.__NEETOS_UNIVERSAL_TASK_CONTEXT_V1) {
        return;
    }

    window.__NEETOS_UNIVERSAL_TASK_CONTEXT_V1 = true;


    /* =====================================================
       CONFIG
       ===================================================== */

    const VERSION = "1.0.0";

    const EXCLUDED_TYPES = new Set([
        "self-study",
        "repair"
    ]);


    /* =====================================================
       HELPERS
       ===================================================== */

    function getData(){
        try {
            return typeof data !== "undefined"
                ? data
                : null;
        } catch(e){
            return null;
        }
    }

    function getTasks(){
        try {
            return typeof tasks !== "undefined"
                ? tasks
                : [];
        } catch(e){
            return [];
        }
    }

    function getSyllabus(){

        /*
           Prefer live NEET OS syllabus from storage.
           This avoids depending on a top-level SYLLABUS const.
        */

        try {

            const raw =
                localStorage.getItem(
                    "neetOSSyllabus"
                );

            if (raw) {

                const parsed =
                    JSON.parse(raw);

                if (
                    parsed &&
                    typeof parsed === "object"
                ){
                    return parsed;
                }
            }

        } catch(e){}

        /*
           Fallback to global SYLLABUS if available.
        */

        try {

            if (
                typeof SYLLABUS !== "undefined" &&
                SYLLABUS &&
                typeof SYLLABUS === "object"
            ){
                return SYLLABUS;
            }

        } catch(e){}

        return {};
    }


    function escapeHTML(value){

        return String(
            value ?? ""
        ).replace(
            /[&<>"']/g,
            char => ({
                "&":"&amp;",
                "<":"&lt;",
                ">":"&gt;",
                '"':"&quot;",
                "'":"&#39;"
            }[char])
        );

    }


    function normaliseSubject(subject){

        const s =
            String(
                subject || ""
            ).trim();

        if (!s){
            return "";
        }

        if (
            s.toLowerCase() ===
            "biology"
        ){
            return "Biology";
        }

        if (
            s.toLowerCase() ===
            "physics"
        ){
            return "Physics";
        }

        if (
            s.toLowerCase() ===
            "chemistry"
        ){
            return "Chemistry";
        }

        return s;
    }


    /* =====================================================
       SYLLABUS → CHAPTERS
       ===================================================== */

    function getChapters(subject){

        const syllabus =
            getSyllabus();

        const normalized =
            normaliseSubject(subject);

        let chapters = [];


        /* -----------------------------------------------
           PHYSICS
           ----------------------------------------------- */

        if (
            normalized === "Physics"
        ){

            chapters =
                Array.isArray(
                    syllabus.Physics
                )
                    ? syllabus.Physics
                    : [];

        }


        /* -----------------------------------------------
           CHEMISTRY
           Physical + Inorganic + Organic
           ----------------------------------------------- */

        if (
            normalized === "Chemistry"
        ){

            const physical =
                Array.isArray(
                    syllabus.PhysicalChemistry
                )
                    ? syllabus.PhysicalChemistry
                    : [];

            const inorganic =
                Array.isArray(
                    syllabus.InorganicChemistry
                )
                    ? syllabus.InorganicChemistry
                    : [];

            const organic =
                Array.isArray(
                    syllabus.OrganicChemistry
                )
                    ? syllabus.OrganicChemistry
                    : [];

            chapters = [
                ...physical,
                ...inorganic,
                ...organic
            ];

            /*
               Some versions may store Chemistry
               directly as an array.
            */

            if (
                !chapters.length &&
                Array.isArray(
                    syllabus.Chemistry
                )
            ){

                chapters =
                    syllabus.Chemistry;

            }

        }


        /* -----------------------------------------------
           BIOLOGY
           Botany + Zoology
           ----------------------------------------------- */

        if (
            normalized === "Biology"
        ){

            const botany =
                Array.isArray(
                    syllabus.Botany
                )
                    ? syllabus.Botany
                    : [];

            const zoology =
                Array.isArray(
                    syllabus.Zoology
                )
                    ? syllabus.Zoology
                    : [];

            chapters = [
                ...botany,
                ...zoology
            ];

            /*
               Fallback if syllabus stores Biology
               directly.
            */

            if (
                !chapters.length &&
                Array.isArray(
                    syllabus.Biology
                )
            ){

                chapters =
                    syllabus.Biology;

            }

        }


        /*
           Clean duplicates
        */

        return [
            ...new Set(
                chapters
                    .map(
                        x =>
                            String(
                                x ?? ""
                            ).trim()
                    )
                    .filter(Boolean)
            )
        ];

    }


    /* =====================================================
       POPUP STATE
       ===================================================== */

    let state = {
        index: null,
        step: 1,
        subject: "",
        chapter: "",
        topic: ""
    };


    /* =====================================================
       POPUP CSS
       ===================================================== */

    function installStyle(){

        if (
            document.getElementById(
                "neetosUniversalContextStyle"
            )
        ){
            return;
        }

        const style =
            document.createElement(
                "style"
            );

        style.id =
            "neetosUniversalContextStyle";

        style.textContent = `

        #neetosUniversalContextOverlay{
            position:fixed;
            inset:0;
            z-index:2147483000;
            display:flex;
            align-items:center;
            justify-content:center;
            padding:18px;
            background:
                rgba(0,0,0,.72);
            backdrop-filter:
                blur(14px);
            -webkit-backdrop-filter:
                blur(14px);
        }

        #neetosUniversalContextBox{
            width:min(
                460px,
                100%
            );
            max-height:
                min(
                    88vh,
                    720px
                );
            overflow:auto;

            background:
                linear-gradient(
                    145deg,
                    rgba(19,22,31,.98),
                    rgba(7,9,14,.98)
                );

            border:
                1px solid
                rgba(255,255,255,.10);

            border-radius:
                24px;

            box-shadow:
                0 30px 90px
                rgba(0,0,0,.55);

            padding:
                24px;

            color:
                #f7f8fb;

            font-family:
                system-ui,
                -apple-system,
                BlinkMacSystemFont,
                "Segoe UI",
                sans-serif;
        }

        .neetos-ctx-top{
            display:flex;
            align-items:center;
            justify-content:space-between;
            gap:12px;
            margin-bottom:18px;
        }

        .neetos-ctx-step{
            font-size:11px;
            font-weight:800;
            letter-spacing:1.5px;
            color:#ff4057;
            text-transform:uppercase;
        }

        .neetos-ctx-task{
            margin-top:5px;
            font-size:18px;
            font-weight:800;
            line-height:1.25;
        }

        .neetos-ctx-close{
            width:38px;
            height:38px;
            border-radius:50%;
            border:
                1px solid
                rgba(255,255,255,.10);
            background:
                rgba(255,255,255,.05);
            color:#fff;
            cursor:pointer;
            font-size:20px;
            display:flex;
            align-items:center;
            justify-content:center;
        }

        .neetos-ctx-progress{
            display:flex;
            gap:7px;
            margin-bottom:22px;
        }

        .neetos-ctx-progress span{
            height:4px;
            flex:1;
            border-radius:20px;
            background:
                rgba(255,255,255,.09);
        }

        .neetos-ctx-progress span.active{
            background:
                linear-gradient(
                    90deg,
                    #ff263f,
                    #ff6374
                );
            box-shadow:
                0 0 12px
                rgba(255,45,70,.35);
        }

        .neetos-ctx-title{
            font-size:25px;
            font-weight:900;
            margin-bottom:7px;
            letter-spacing:-.4px;
        }

        .neetos-ctx-subtitle{
            color:
                rgba(255,255,255,.58);
            font-size:13px;
            line-height:1.5;
            margin-bottom:18px;
        }

        .neetos-ctx-options{
            display:grid;
            grid-template-columns:
                repeat(2,minmax(0,1fr));
            gap:10px;
            margin-top:10px;
        }

        .neetos-ctx-option{
            min-height:52px;
            padding:12px 13px;
            border-radius:15px;
            border:
                1px solid
                rgba(255,255,255,.08);
            background:
                rgba(255,255,255,.045);
            color:#f5f7fb;
            text-align:left;
            cursor:pointer;
            font-size:14px;
            font-weight:750;
            transition:
                transform .16s ease,
                border-color .16s ease,
                background .16s ease;
        }

        .neetos-ctx-option:hover{
            transform:translateY(-1px);
            border-color:
                rgba(255,50,75,.45);
            background:
                rgba(255,45,65,.09);
        }

        .neetos-ctx-option.selected{
            border-color:
                rgba(255,50,75,.75);
            background:
                linear-gradient(
                    135deg,
                    rgba(255,35,58,.18),
                    rgba(255,35,58,.06)
                );
            box-shadow:
                0 0 0 1px
                rgba(255,35,58,.10)
                inset;
        }

        .neetos-ctx-select{
            width:100%;
            min-height:54px;
            padding:
                0 14px;

            border-radius:
                15px;

            border:
                1px solid
                rgba(255,255,255,.10);

            background:
                #11151e;

            color:#fff;

            outline:none;

            font-size:14px;
            font-weight:650;
        }

        .neetos-ctx-select:focus{
            border-color:
                rgba(255,50,75,.75);

            box-shadow:
                0 0 0 3px
                rgba(255,50,75,.10);
        }

        .neetos-ctx-input{
            width:100%;
            min-height:56px;
            box-sizing:border-box;

            padding:
                0 15px;

            border-radius:
                15px;

            border:
                1px solid
                rgba(255,255,255,.10);

            background:
                #11151e;

            color:#fff;

            outline:none;

            font-size:15px;
            font-weight:600;
        }

        .neetos-ctx-input:focus{
            border-color:
                rgba(255,50,75,.75);

            box-shadow:
                0 0 0 3px
                rgba(255,50,75,.10);
        }

        .neetos-ctx-actions{
            display:flex;
            gap:10px;
            margin-top:20px;
        }

        .neetos-ctx-btn{
            flex:1;
            min-height:50px;
            border-radius:15px;
            border:0;
            cursor:pointer;
            font-size:14px;
            font-weight:850;
        }

        .neetos-ctx-back{
            background:
                rgba(255,255,255,.07);
            color:#fff;
            border:
                1px solid
                rgba(255,255,255,.08);
        }

        .neetos-ctx-next{
            background:
                linear-gradient(
                    135deg,
                    #ef233c,
                    #ff4057
                );
            color:#fff;
            box-shadow:
                0 10px 28px
                rgba(239,35,60,.25);
        }

        .neetos-ctx-next:disabled{
            opacity:.38;
            cursor:not-allowed;
            box-shadow:none;
        }

        .neetos-ctx-note{
            margin-top:11px;
            font-size:11px;
            color:
                rgba(255,255,255,.42);
            line-height:1.5;
        }

        @media(max-width:520px){

            #neetosUniversalContextOverlay{
                padding:10px;
                align-items:flex-end;
            }

            #neetosUniversalContextBox{
                width:100%;
                max-height:92vh;
                border-radius:24px 24px 16px 16px;
                padding:20px;
            }

            .neetos-ctx-options{
                grid-template-columns:1fr;
            }

            .neetos-ctx-title{
                font-size:23px;
            }

        }

        `;

        document.head.appendChild(style);

    }


    /* =====================================================
       REMOVE POPUP
       ===================================================== */

    function closePopup(){

        const old =
            document.getElementById(
                "neetosUniversalContextOverlay"
            );

        if (old){
            old.remove();
        }

        state = {
            index:null,
            step:1,
            subject:"",
            chapter:"",
            topic:""
        };

    }


    /* =====================================================
       SAVE CONTEXT
       ===================================================== */

    function saveContext(){

        const d =
            getData();

        const allTasks =
            getTasks();

        const index =
            state.index;

        const task =
            allTasks[index];

        if (
            !d ||
            !task
        ){
            return false;
        }


        d.taskMeta =
            d.taskMeta || {};


        const old =
            d.taskMeta[index] || {};


        d.taskMeta[index] = {

            ...old,

            /*
               Main context
            */

            subject:
                state.subject,

            chapter:
                state.chapter,

            topic:
                state.topic,


            /*
               Live / Guardian compatibility
            */

            addonVersion:
                VERSION,

            addonActivity:
                task.name,

            addonSubject:
                state.subject,

            addonChapter:
                state.chapter,

            addonTopic:
                state.topic,

            /*
               Useful explicit fields
            */

            selectedSubject:
                state.subject,

            selectedChapter:
                state.chapter,

            selectedTopic:
                state.topic,

            contextUpdatedAt:
                Date.now()

        };


        /*
           Persist using existing NEET OS engine.
        */

        try {

            if (
                typeof saveData ===
                "function"
            ){
                saveData();
            }

        } catch(e){

            console.warn(
                "NEET OS context save warning:",
                e
            );

        }


        return true;

    }


    /* =====================================================
       BUILD POPUP
       ===================================================== */

    function renderPopup(){

        closeExistingOnly();

        installStyle();


        const allTasks =
            getTasks();

        const task =
            allTasks[state.index];


        if (!task){
            return;
        }


        const overlay =
            document.createElement(
                "div"
            );

        overlay.id =
            "neetosUniversalContextOverlay";


        const box =
            document.createElement(
                "div"
            );

        box.id =
            "neetosUniversalContextBox";


        overlay.appendChild(box);


        const subject =
            normaliseSubject(
                state.subject ||
                task.subject
            );


        state.subject =
            subject;


        let content = "";


        /* =================================================
           TOP
           ================================================= */

        content += `

            <div class="neetos-ctx-top">

                <div>

                    <div class="neetos-ctx-step">
                        STEP ${state.step} OF 3
                    </div>

                    <div class="neetos-ctx-task">
                        ${escapeHTML(task.name)}
                    </div>

                </div>

                <button
                    type="button"
                    class="neetos-ctx-close"
                    id="neetosCtxClose"
                    aria-label="Close"
                >
                    ×
                </button>

            </div>


            <div class="neetos-ctx-progress">

                <span class="${
                    state.step >= 1
                        ? "active"
                        : ""
                }"></span>

                <span class="${
                    state.step >= 2
                        ? "active"
                        : ""
                }"></span>

                <span class="${
                    state.step >= 3
                        ? "active"
                        : ""
                }"></span>

            </div>
        `;


        /* =================================================
           STEP 1 — SUBJECT
           ================================================= */

        if (
            state.step === 1
        ){

            content += `

                <div class="neetos-ctx-title">
                    Choose Subject
                </div>

                <div class="neetos-ctx-subtitle">
                    Which subject are you studying
                    in this task?
                </div>

                <div class="neetos-ctx-options">

                    ${[
                        "Physics",
                        "Chemistry",
                        "Biology"
                    ].map(
                        s => `

                        <button
                            type="button"
                            class="
                                neetos-ctx-option
                                ${
                                    state.subject === s
                                        ? "selected"
                                        : ""
                                }
                            "
                            data-subject="${escapeHTML(s)}"
                        >
                            ${escapeHTML(s)}
                        </button>

                        `
                    ).join("")}

                </div>

                <div class="neetos-ctx-note">
                    Subject will be saved with this
                    specific study session.
                </div>

            `;

        }


        /* =================================================
           STEP 2 — CHAPTER
           ================================================= */

        if (
            state.step === 2
        ){

            const chapters =
                getChapters(
                    state.subject
                );


            content += `

                <div class="neetos-ctx-title">
                    Choose Chapter
                </div>

                <div class="neetos-ctx-subtitle">
                    Select the exact NCERT / NEET
                    chapter for this task.
                </div>

            `;


            if (
                chapters.length
            ){

                content += `

                    <select
                        id="neetosCtxChapter"
                        class="neetos-ctx-select"
                    >

                        <option value="">
                            Select chapter
                        </option>

                        ${chapters.map(
                            chapter => `

                            <option
                                value="${escapeHTML(chapter)}"
                                ${
                                    state.chapter === chapter
                                        ? "selected"
                                        : ""
                                }
                            >
                                ${escapeHTML(chapter)}
                            </option>

                            `
                        ).join("")}

                    </select>

                `;

            } else {

                /*
                   If syllabus data cannot be found,
                   allow manual chapter entry instead
                   of creating "Chapter not specified".
                */

                content += `

                    <input
                        id="neetosCtxChapter"
                        class="neetos-ctx-input"
                        type="text"
                        placeholder="Enter chapter name"
                        value="${escapeHTML(
                            state.chapter
                        )}"
                        autocomplete="off"
                    />

                    <div class="neetos-ctx-note">
                        Your current syllabus list was not
                        available, so enter the chapter manually.
                    </div>

                `;

            }

        }


        /* =================================================
           STEP 3 — TOPIC
           ================================================= */

        if (
            state.step === 3
        ){

            content += `

                <div class="neetos-ctx-title">
                    Choose Topic
                </div>

                <div class="neetos-ctx-subtitle">
                    Optional — enter the exact topic,
                    concept, lecture part or question area.
                </div>

                <input
                    id="neetosCtxTopic"
                    class="neetos-ctx-input"
                    type="text"
                    placeholder="e.g. Projectile Motion"
                    value="${escapeHTML(
                        state.topic
                    )}"
                    autocomplete="off"
                />

                <div class="neetos-ctx-note">
                    You can leave this empty if the
                    entire chapter is being studied.
                </div>

            `;

        }


        /* =================================================
           ACTIONS
           ================================================= */

        content += `

            <div class="neetos-ctx-actions">

                ${
                    state.step > 1
                    ? `
                        <button
                            type="button"
                            id="neetosCtxBack"
                            class="
                                neetos-ctx-btn
                                neetos-ctx-back
                            "
                        >
                            Back
                        </button>
                    `
                    : `
                        <button
                            type="button"
                            id="neetosCtxCancel"
                            class="
                                neetos-ctx-btn
                                neetos-ctx-back
                            "
                        >
                            Cancel
                        </button>
                    `
                }

                <button
                    type="button"
                    id="neetosCtxNext"
                    class="
                        neetos-ctx-btn
                        neetos-ctx-next
                    "
                >
                    ${
                        state.step === 3
                            ? "Start Study"
                            : "Continue"
                    }
                </button>

            </div>

        `;


        box.innerHTML =
            content;


        document.body.appendChild(
            overlay
        );


        /* =================================================
           CLOSE
           ================================================= */

        box.querySelector(
            "#neetosCtxClose"
        )?.addEventListener(
            "click",
            closePopup
        );


        box.querySelector(
            "#neetosCtxCancel"
        )?.addEventListener(
            "click",
            closePopup
        );


        overlay.addEventListener(
            "click",
            event => {

                if (
                    event.target ===
                    overlay
                ){
                    closePopup();
                }

            }
        );


        /* =================================================
           STEP 1 EVENTS
           ================================================= */

        box.querySelectorAll(
            "[data-subject]"
        ).forEach(
            button => {

                button.addEventListener(
                    "click",
                    () => {

                        state.subject =
                            normaliseSubject(
                                button.dataset.subject
                            );

                        renderPopup();

                    }
                );

            }
        );


        /* =================================================
           STEP 2 CHAPTER CHANGE
           ================================================= */

        const chapterInput =
            box.querySelector(
                "#neetosCtxChapter"
            );


        if (chapterInput){

            chapterInput.addEventListener(
                "change",
                () => {

                    state.chapter =
                        String(
                            chapterInput.value ||
                            ""
                        ).trim();

                }
            );


            chapterInput.addEventListener(
                "input",
                () => {

                    state.chapter =
                        String(
                            chapterInput.value ||
                            ""
                        ).trim();

                }
            );

        }


        /* =================================================
           STEP 3 TOPIC
           ================================================= */

        const topicInput =
            box.querySelector(
                "#neetosCtxTopic"
            );


        if (topicInput){

            topicInput.addEventListener(
                "input",
                () => {

                    state.topic =
                        String(
                            topicInput.value ||
                            ""
                        ).trim();

                }
            );

        }


        /* =================================================
           NEXT
           ================================================= */

        const next =
            box.querySelector(
                "#neetosCtxNext"
            );


        next?.addEventListener(
            "click",
            () => {

                /* -----------------------------------------
                   STEP 1
                   ----------------------------------------- */

                if (
                    state.step === 1
                ){

                    if (
                        !state.subject
                    ){

                        alert(
                            "Please select a subject first."
                        );

                        return;
                    }


                    state.step =
                        2;

                    renderPopup();

                    return;
                }


                /* -----------------------------------------
                   STEP 2
                   ----------------------------------------- */

                if (
                    state.step === 2
                ){

                    /*
                       Read current input one final time.
                    */

                    const currentChapter =
                        box.querySelector(
                            "#neetosCtxChapter"
                        )?.value?.trim() ||
                        state.chapter ||
                        "";


                    state.chapter =
                        currentChapter;


                    if (
                        !state.chapter
                    ){

                        alert(
                            "Please select a chapter first."
                        );

                        return;
                    }


                    state.step =
                        3;

                    renderPopup();

                    return;
                }


                /* -----------------------------------------
                   STEP 3
                   ----------------------------------------- */

                if (
                    state.step === 3
                ){

                    const currentTopic =
                        box.querySelector(
                            "#neetosCtxTopic"
                        )?.value?.trim() ||
                        state.topic ||
                        "";


                    state.topic =
                        currentTopic;


                    /*
                       Save before starting.
                    */

                    if (
                        !saveContext()
                    ){

                        alert(
                            "NEET OS data is not ready yet."
                        );

                        return;
                    }


                    const index =
                        state.index;


                    closePopup();


                    /*
                       IMPORTANT:
                       Use existing start engine.
                       Nothing in the original timer
                       system is replaced.
                    */

                    try {

                        if (
                            typeof actuallyStartTask ===
                            "function"
                        ){

                            actuallyStartTask(
                                index
                            );

                        } else {

                            alert(
                                "NEET OS start engine is not ready yet."
                            );

                        }

                    } catch(error){

                        console.error(
                            "NEET OS Universal Context start error:",
                            error
                        );

                        alert(
                            "Could not start this task."
                        );

                    }

                }

            }
        );


        /* =================================================
           BACK
           ================================================= */

        box.querySelector(
            "#neetosCtxBack"
        )?.addEventListener(
            "click",
            () => {

                if (
                    state.step > 1
                ){

                    state.step--;

                    renderPopup();

                }

            }
        );

    }


    /* =====================================================
       REMOVE ONLY OUR OWN OLD POPUP
       ===================================================== */

    function closeExistingOnly(){

        const old =
            document.getElementById(
                "neetosUniversalContextOverlay"
            );

        if (old){
            old.remove();
        }

    }


    /* =====================================================
       OPEN CONTEXT FLOW
       ===================================================== */

    function openContext(index){

        const allTasks =
            getTasks();

        const task =
            allTasks[index];

        if (
            !task
        ){
            return;
        }


        /*
           Never interfere with:
           Self Study
           Daily Repair
        */

        if (
            EXCLUDED_TYPES.has(
                task.type
            )
        ){
            return;
        }


        const d =
            getData();


        const previous =
            d?.taskMeta?.[index] ||
            {};


        state = {

            index,

            step:1,

            subject:
                normaliseSubject(
                    previous.subject ||
                    previous.selectedSubject ||
                    previous.addonSubject ||
                    task.subject ||
                    ""
                ),

            chapter:
                String(
                    previous.chapter ||
                    previous.selectedChapter ||
                    previous.addonChapter ||
                    ""
                ).trim(),

            topic:
                String(
                    previous.topic ||
                    previous.selectedTopic ||
                    previous.addonTopic ||
                    ""
                ).trim()

        };


        renderPopup();

    }


    /* =====================================================
       INTERCEPT NORMAL START BUTTON
       ===================================================== */

    function installInterceptor(){

        if (
            window.__NEETOSUniversalTaskContextBound
        ){
            return;
        }

        window.__NEETOSUniversalTaskContextBound =
            true;


        document.addEventListener(
            "click",
            event => {

                const button =
                    event.target?.closest?.(
                        ".start-button"
                    );


                if (!button){
                    return;
                }


                const allButtons =
                    Array.from(
                        document.querySelectorAll(
                            ".start-button"
                        )
                    );


                const index =
                    allButtons.indexOf(
                        button
                    );


                if (
                    index < 0
                ){
                    return;
                }


                const allTasks =
                    getTasks();

                const task =
                    allTasks[index];


                if (
                    !task
                ){
                    return;
                }


                /*
                   Do NOT intercept the active task.
                   That click must continue to STOP it.
                */

                const d =
                    getData();


                if (
                    d &&
                    Number(
                        d.activeTask
                    ) === index
                ){
                    return;
                }


                /*
                   Self Study / Daily Repair keep
                   their existing advanced popup.
                */

                if (
                    EXCLUDED_TYPES.has(
                        task.type
                    )
                ){
                    return;
                }


                /*
                   Capture BEFORE the original
                   start-button listener.
                */

                event.preventDefault();

                event.stopImmediatePropagation();


                openContext(
                    index
                );

            },
            true
        );

    }


    /* =====================================================
       INIT
       ===================================================== */

    function init(){

        installStyle();

        installInterceptor();


        console.log(
            "✅ NEET OS — Universal Subject + Chapter + Topic Selector v1.0 loaded."
        );

    }


    if (
        document.readyState ===
        "loading"
    ){

        document.addEventListener(
            "DOMContentLoaded",
            init,
            {
                once:true
            }
        );

    } else {

        init();

    }


    /* =====================================================
       PUBLIC API
       ===================================================== */

    window.NEETOSUniversalTaskContext = {

        version:
            VERSION,

        open:
            openContext,

        close:
            closePopup

    };


})();