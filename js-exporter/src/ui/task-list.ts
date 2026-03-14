import type { Task, TaskStatus } from "../types";
import { now } from "../utils/format";

interface TaskInput {
  id: string;
  label: string;
  type?: string;
  projectName?: string | null;
  status?: TaskStatus;
  detail?: string | null;
  error?: string | null;
}

interface TaskChanges {
  status?: TaskStatus;
  detail?: string | null;
  error?: string | null;
  fileCount?: number;
  [key: string]: unknown;
}

export interface TaskList {
  add(task: TaskInput): void;
  update(id: string, changes: TaskChanges): void;
  getVisible(): Task[];
  render(): void;
}

export const createTaskList = (): TaskList => {
  const _tasks: Task[] = [];
  let _dirty = false;

  const add = (task: TaskInput): void => {
    const status = task.status || "queued";
    _tasks.push({
      id: task.id,
      type: task.type || "conversation",
      label: task.label || "",
      projectName: task.projectName || null,
      status,
      detail: task.detail || null,
      error: task.error || null,
      startedAt:
        status === "active"
          ? now()
          : status === "queued"
            ? null
            : now(),
      completedAt:
        status === "done" || status === "failed" ? now() : null,
    });
    _dirty = true;
  };

  const update = (id: string, changes: TaskChanges): void => {
    for (let i = 0; i < _tasks.length; i++) {
      if (_tasks[i].id === id) {
        const t = _tasks[i];
        for (const k in changes) {
          if (Object.prototype.hasOwnProperty.call(changes, k)) {
            (t as unknown as Record<string, unknown>)[k] = changes[k];
          }
        }
        if (
          (changes.status === "done" || changes.status === "failed") &&
          !t.completedAt
        ) {
          t.completedAt = now();
        }
        if (changes.status === "active" && !t.startedAt) {
          t.startedAt = now();
        }
        _dirty = true;
        return;
      }
    }
  };

  const getVisible = (): Task[] => {
    const failed: Task[] = [];
    const active: Task[] = [];
    const done: Task[] = [];
    const queued: Task[] = [];
    for (let i = 0; i < _tasks.length; i++) {
      const t = _tasks[i];
      if (t.status === "failed") failed.push(t);
      else if (t.status === "active") active.push(t);
      else if (t.status === "done") done.push(t);
      else if (t.status === "queued") queued.push(t);
    }
    const visibleDone =
      done.length > 30 ? done.slice(done.length - 30) : done;
    const visibleQueued =
      queued.length > 10 ? queued.slice(0, 10) : queued;
    return ([] as Task[]).concat(failed, visibleDone, active, visibleQueued);
  };

  const render = (): void => {
    if (!_dirty) return;
    _dirty = false;
    const el = document.getElementById("cvz-tasks");
    if (!el) return;
    const wasAtBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight < 10;
    const visible = getVisible();
    let html = "";
    for (let i = 0; i < visible.length; i++) {
      const t = visible[i];
      const cls = "cvz-task-" + t.status;
      let prefix = "";
      let style = "";
      if (t.status === "queued") {
        prefix = "\u00b7 ";
        style = "opacity:0.5;";
      } else if (t.status === "active") {
        prefix =
          '<span class="cvz-spin" style="display:inline-block;animation:cvz-spin 1s linear infinite;">\u27f3</span> ';
        style = "color:#10a37f;";
      } else if (t.status === "done") {
        prefix = "\u2713 ";
        style = "opacity:0.6;";
      } else if (t.status === "failed") {
        prefix = "\u2717 ";
        style = "color:#ef4444;";
      }
      const projPrefix = t.projectName
        ? '<span style="opacity:0.7;">[' + t.projectName + "]</span> "
        : "";
      const errorSuffix =
        t.status === "failed" && t.error
          ? ' <span style="opacity:0.8;">(' + t.error + ")</span>"
          : "";
      html +=
        '<div class="' +
        cls +
        '" style="' +
        style +
        'padding:1px 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' +
        prefix +
        projPrefix +
        t.label +
        errorSuffix +
        "</div>";
      if (t.status === "active" && t.detail) {
        html +=
          '<div class="cvz-task-detail" style="padding-left:16px;opacity:0.7;padding:1px 0;">\u21b3 ' +
          t.detail +
          "</div>";
      }
    }
    el.innerHTML = html;
    if (wasAtBottom) el.scrollTop = el.scrollHeight;
  };

  return { add, update, getVisible, render };
};
