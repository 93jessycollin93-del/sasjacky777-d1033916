import type { ReactNode } from "react";
import { Link, NavLink } from "react-router-dom";
import { ArrowLeft, CalendarDays, Plus, RefreshCw, SquareKanban } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { BOARD_LIMIT } from "@/lib/taskBoard";

interface TaskViewShellProps {
  /** The page's heading, for screen readers; the view switch shows it visually. */
  title: string;
  /** "4 open · 2 done", shown once the tasks are in. */
  summary: string;
  taskCount: number;
  loaded: boolean;
  loading: boolean;
  loadError: string | null;
  onRefresh: () => void;
  onNew: () => void;
  children: ReactNode;
}

const VIEWS = [
  { to: "/tasks", label: "Board", icon: SquareKanban },
  { to: "/tasks/calendar", label: "Calendar", icon: CalendarDays },
] as const;

/**
 * The frame both task views share: the header, the switch between them, and
 * the three states that come before there is anything to show — loading, a
 * read that failed, and a read that hit the cap. Kept in one place so neither
 * view can forget to say that its tasks did not load.
 */
export const TaskViewShell = ({
  title,
  summary,
  taskCount,
  loaded,
  loading,
  loadError,
  onRefresh,
  onNew,
  children,
}: TaskViewShellProps) => (
  <div className="min-h-screen w-full bg-background flex flex-col">
    <header className="flex flex-wrap items-center gap-2 px-3 py-1.5 border-b border-border bg-sidebar sticky top-0 z-10">
      <h1 className="sr-only">{title}</h1>
      <Link
        to="/"
        className="flex items-center gap-1.5 px-2 py-1 rounded-sm font-mono text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
      >
        <ArrowLeft size={14} />
        Jackie
      </Link>
      <nav aria-label="Task views" className="flex items-center gap-1">
        {VIEWS.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end
            className={({ isActive }) =>
              cn(
                "flex items-center gap-1.5 px-2 py-1 rounded-sm font-mono text-xs uppercase tracking-widest transition-colors",
                isActive ? "text-foreground bg-secondary" : "text-muted-foreground hover:text-foreground",
              )
            }
          >
            <Icon size={13} className="text-primary" aria-hidden />
            {label}
          </NavLink>
        ))}
      </nav>
      {loaded && <span className="font-mono text-[10px] text-muted-foreground">{summary}</span>}
      <div className="flex-1" />
      <Button
        variant="ghost"
        size="sm"
        className="font-mono text-[10px] uppercase tracking-widest"
        onClick={onRefresh}
        disabled={loading}
      >
        <RefreshCw size={12} className={cn("mr-1", loading && "animate-spin")} />
        Refresh
      </Button>
      <Button size="sm" className="font-mono text-[10px] uppercase tracking-widest" onClick={onNew} disabled={!loaded}>
        <Plus size={12} className="mr-1" />
        New task
      </Button>
    </header>

    <main className="flex-1 p-4">
      {!loaded && loadError ? (
        <div role="alert" className="max-w-md mx-auto mt-16 text-center space-y-3">
          <p className="font-mono text-sm text-destructive">Couldn't load your tasks.</p>
          <p className="font-mono text-xs text-muted-foreground">{loadError}</p>
          <Button variant="outline" size="sm" onClick={onRefresh}>
            Try again
          </Button>
        </div>
      ) : !loaded ? (
        <p className="font-mono text-xs text-muted-foreground text-center mt-16">Loading tasks…</p>
      ) : (
        <div className="max-w-7xl mx-auto space-y-3">
          {loadError && (
            <p role="alert" className="font-mono text-xs text-destructive">
              Couldn't refresh — showing what was loaded before. {loadError}
            </p>
          )}
          {taskCount >= BOARD_LIMIT && (
            <p className="font-mono text-xs text-muted-foreground">
              Showing your newest {BOARD_LIMIT} tasks. Older ones exist but are not shown here.
            </p>
          )}
          {children}
        </div>
      )}
    </main>
  </div>
);
