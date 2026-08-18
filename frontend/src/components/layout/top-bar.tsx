import { ArrowLeftRight, Search } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { NotificationsMenu } from "@/components/layout/notifications-menu";
import { ThemeToggle } from "@/providers/theme-provider";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { MobileNavTrigger } from "@/components/layout/app-sidebar";
import { clearStoredTokens } from "@/lib/api-client";

/**
 * Optional cross-link to the other GV business. This is the NUTRITION app, so it
 * points AT Attire — the mirror of Attire's own button, which points here.
 * Hidden until VITE_OTHER_APP_URL is set.
 * NOTE: VITE_OTHER_APP_URL is a build-time var — it only takes effect after a fresh build.
 */
const OTHER_APP_URL = import.meta.env.VITE_OTHER_APP_URL as string | undefined;
const OTHER_APP_NAME =
  (import.meta.env.VITE_OTHER_APP_NAME as string | undefined) ?? "Attire by GV";

export function TopBar({ title }: { title: string }) {
  const navigate = useNavigate();

  function signOut() {
    clearStoredTokens();
    navigate("/login", { replace: true });
  }

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b border-primary/15 bg-background/80 px-4 backdrop-blur-md supports-[backdrop-filter]:bg-background/70 sm:px-6">
      <MobileNavTrigger />
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-sm font-semibold tracking-tight sm:text-base">
          <span className="mr-2 inline-block size-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
          {title}
        </h1>
      </div>
      <div className="hidden max-w-xs flex-1 md:block lg:max-w-md">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search…"
            className="h-9 rounded-full border-border/80 bg-muted/40 pl-9 transition-colors focus-visible:bg-background"
            aria-label="Global search"
          />
        </div>
      </div>
      {OTHER_APP_URL ? (
        <Button
          asChild
          type="button"
          variant="outline"
          size="sm"
          className="hidden gap-1.5 rounded-full border-border/80 sm:inline-flex"
          title={`Switch to ${OTHER_APP_NAME}`}
        >
          <a href={OTHER_APP_URL} target="_blank" rel="noopener noreferrer">
            <ArrowLeftRight className="size-3.5" />
            {OTHER_APP_NAME}
          </a>
        </Button>
      ) : null}
      <NotificationsMenu />
      <ThemeToggle />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="hidden rounded-full border-border/80 sm:inline-flex"
          >
            Store
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuLabel>Workspace</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link to="/dashboard">Dashboard</Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link to="/dashboard/inventory">Inventory</Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link to="/billing">Billing</Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={signOut}>Sign out</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
