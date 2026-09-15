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
