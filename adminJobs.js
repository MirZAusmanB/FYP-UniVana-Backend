
const { spawn } = require("child_process");
const path = require("path");
const AdminJob = require("./models/adminJob");

const SCRAPPERS_DIR = path.resolve(__dirname, "../Scrappers");

const PYTHON = process.env.PYTHON_CMD || "python3";

const SCRIPTS = {
  sendReminders: {
    command: "node",
    args: ["sendReminders.js"],
    cwd: __dirname,
    label: "Send Reminder Emails",
  },
  countriesScrapper: {
    command: PYTHON,
    args: ["countries_scrapper.py"],
    cwd: SCRAPPERS_DIR,
    label: "Countries Scrapper",
  },
  universityScrapper: {
    command: PYTHON,
    args: ["university_scrapper.py"],
    cwd: SCRAPPERS_DIR,
    label: "University Scrapper",
  },
  programsScrapper: {
    command: PYTHON,
    args: ["programs_scrapper.py"],
    cwd: SCRAPPERS_DIR,
    label: "Programs Scrapper",
  },
};

const jobs = new Map();

let nextId = 1;


function parseLine(line, results) {
  const trimmed = line.trim();

  if (trimmed.startsWith("[CREATED]")) {
    const detail = trimmed.replace("[CREATED]", "").trim();
    results.created.push(detail);
  } else if (trimmed.startsWith("[UPDATED]")) {
    const detail = trimmed.replace("[UPDATED]", "").trim();
    results.updated.push(detail);
  } else if (trimmed.startsWith("[UNCHANGED]")) {
    results.unchanged += 1;
  } else if (trimmed.startsWith("[ERROR]")) {
    const detail = trimmed.replace("[ERROR]", "").trim();
    results.errors.push(detail);
  } else if (trimmed.startsWith("Sent reminder to")) {
    results.created.push(trimmed);
  } else if (trimmed.startsWith("No reminders to send today")) {
    results.created.push(trimmed);
  }
}


function startJob(scriptKey) {
  const script = SCRIPTS[scriptKey];
  if (!script) {
    throw new Error("Unknown script: " + scriptKey);
  }

  for (const job of jobs.values()) {
    if (job.scriptKey === scriptKey && job.status === "running") {
      throw new Error("This script is already running");
    }
  }

  const id = String(nextId++);
  const job = {
    id,
    scriptKey,
    label: script.label,
    status: "running",
    startedAt: new Date(),
    finishedAt: null,
    exitCode: null,
    logs: [],
    results: { created: [], updated: [], unchanged: 0, errors: [] },
  };

  jobs.set(id, job);

  // Spawn the process
  const child = spawn(script.command, script.args, {
    cwd: script.cwd,
    env: { ...process.env, PYTHONUNBUFFERED: "1", PYTHONIOENCODING: "utf-8" }, 
  });

  // Append a line to job.logs, keeping only the most recent 5000 lines
  const pushLog = (line) => {
    job.logs.push(line);
    if (job.logs.length > 5000) job.logs.shift();
  };

  // Read stdout line by line
  let stdoutBuffer = "";
  child.stdout.on("data", (chunk) => {
    stdoutBuffer += chunk.toString();
    const lines = stdoutBuffer.split("\n");
    // Keep the last incomplete line in the buffer
    stdoutBuffer = lines.pop();
    for (const line of lines) {
      const trimmed = line.trimEnd();
      if (trimmed) {
        pushLog(trimmed);
        parseLine(trimmed, job.results);
      }
    }
  });

  // Also capture stderr (some scripts print errors here)
  child.stderr.on("data", (chunk) => {
    const lines = chunk.toString().split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed) {
        pushLog(trimmed);
        job.results.errors.push(trimmed);
      }
    }
  });

  const persist = async () => {
    try {
      await AdminJob.create({
        scriptKey: job.scriptKey,
        label: job.label,
        status: job.status,
        startedAt: job.startedAt,
        finishedAt: job.finishedAt,
        exitCode: job.exitCode,
        logs: job.logs,
        results: job.results,
      });
    } catch (err) {
      console.error("[adminJobs] failed to save job to DB:", err.message);
    }
  };

  child.on("close", async (code) => {
    // Process any remaining data in the buffer
    if (stdoutBuffer.trim()) {
      pushLog(stdoutBuffer.trim());
      parseLine(stdoutBuffer, job.results);
    }
    job.status = code === 0 ? "completed" : "failed";
    job.exitCode = code;
    job.finishedAt = new Date();
    await persist();
  });

  child.on("error", async (err) => {
    job.status = "failed";
    job.exitCode = -1;
    job.finishedAt = new Date();
    pushLog(err.message);
    job.results.errors.push(err.message);
    await persist();
  });

  return job;
}


function getJobs() {
  return Array.from(jobs.values()).reverse();
}


function getJob(id) {
  return jobs.get(id) || null;
}

module.exports = { startJob, getJobs, getJob, SCRIPTS };
