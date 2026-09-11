"use client";

import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import {
  getArticleAction,
  importOpmlAction,
  loadMoreAction,
  markAllReadAction,
  markFeedReadAction,
  refreshAction,
  setReadAction,
  setStarredAction,
  subscribeAction,
  unsubscribeAction,
} from "@/app/actions";
import { readerHref } from "@/lib/reader-href";
import { STARTER_FEEDS } from "@/lib/starter-feeds";
import { formatAbsoluteTime, formatRelativeTime } from "@/lib/time";
import type { ArticleFilter } from "@/server/queries";
import type { ClientArticle, ReaderProps } from "./types";

type Toast = { kind: "ok" | "err"; text: string };

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : value.toISOString();
}

export function Reader(props: ReaderProps) {
  const router = useRouter();
  const [articles, setArticles] = useState(props.articles);
  const [nextCursor, setNextCursor] = useState(props.nextCursor);
  const [selected, setSelected] = useState(props.selected);
  const [toast, setToast] = useState<Toast | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [mobilePane, setMobilePane] = useState<"list" | "article">(
    props.selected ? "article" : "list",
  );
  const [pending, startTransition] = useTransition();
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setArticles(props.articles);
    setNextCursor(props.nextCursor);
    setSelected(props.selected);
  }, [props.articles, props.nextCursor, props.selected]);

  const query = useMemo(
    () => ({
      filter: props.filter,
      feedId: props.feedId,
      articleId: selected?.id ?? null,
      q: props.query,
    }),
    [props.filter, props.feedId, props.query, selected?.id],
  );

  const flash = useCallback((kind: Toast["kind"], text: string) => {
    setToast({ kind, text });
    window.setTimeout(() => setToast(null), 4200);
  }, []);

  const go = useCallback(
    (patch: Partial<typeof query>) => {
      router.push(readerHref({ ...query, ...patch }));
    },
    [query, router],
  );

  const selectArticle = useCallback(
    (article: ClientArticle, markRead = true) => {
      setSelected((current) => ({
        content: current?.id === article.id ? current.content : null,
        feedSiteUrl: current?.id === article.id ? current.feedSiteUrl : null,
        ...article,
      }));
      setMobilePane("article");
      router.replace(readerHref({ ...query, articleId: article.id }), {
        scroll: false,
      });
      startTransition(async () => {
        const detail = await getArticleAction(article.id);
        if (detail) setSelected(detail);
        if (markRead && !article.isRead) {
          setArticles((current) =>
            current.map((row) =>
              row.id === article.id ? { ...row, isRead: true } : row,
            ),
          );
          await setReadAction(article.id, true);
        }
      });
    },
    [query, router],
  );

  const selectedIndex = articles.findIndex((row) => row.id === selected?.id);

  const move = useCallback(
    (delta: number) => {
      if (articles.length === 0) return;
      const nextIndex = Math.min(
        articles.length - 1,
        Math.max(0, (selectedIndex < 0 ? 0 : selectedIndex) + delta),
      );
      const next = articles[nextIndex];
      if (next) selectArticle(next);
    },
    [articles, selectArticle, selectedIndex],
  );

  const loadMore = useCallback(() => {
    if (!nextCursor || pending) return;
    startTransition(async () => {
      const page = await loadMoreAction({
        feedId: props.feedId ?? undefined,
        filter: props.filter,
        search: props.query || undefined,
        cursor: nextCursor,
      });
      setArticles((current) => {
        const seen = new Set(current.map((row) => row.id));
        return [
          ...current,
          ...page.items
            .filter((row) => !seen.has(row.id))
            .map((row) => ({
              ...row,
              publishedAt: toIso(row.publishedAt),
            })),
        ];
      });
      setNextCursor(page.nextCursor);
    });
  }, [nextCursor, pending, props.feedId, props.filter, props.query]);

  useEffect(() => {
    const node = listRef.current;
    if (!node || !nextCursor) return;
    const sentinel = node.querySelector("[data-sentinel]");
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) loadMore();
      },
      { root: node, rootMargin: "200px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loadMore, nextCursor]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target;
      const typing =
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);

      if (event.key === "Escape") {
        setAddOpen(false);
        setHelpOpen(false);
        if (typing) (target as HTMLElement).blur();
        return;
      }

      if (typing) return;

      if (event.key === "?" || (event.shiftKey && event.key === "/")) {
        event.preventDefault();
        setHelpOpen((open) => !open);
        return;
      }
      if (event.key === "/") {
        event.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
        return;
      }
      if (event.key === "a") {
        event.preventDefault();
        setAddOpen(true);
        return;
      }
      if (event.key === "j" || event.key === "ArrowDown") {
        event.preventDefault();
        move(1);
        return;
      }
      if (event.key === "k" || event.key === "ArrowUp") {
        event.preventDefault();
        move(-1);
        return;
      }
      if (event.key === "1") go({ filter: "all", articleId: null });
      if (event.key === "2") go({ filter: "unread", articleId: null });
      if (event.key === "3") go({ filter: "starred", articleId: null });
      if ((event.key === "o" || event.key === "Enter") && selected?.url) {
        event.preventDefault();
        window.open(selected.url, "_blank", "noopener,noreferrer");
      }
      if (event.key === "s" && selected) {
        event.preventDefault();
        const next = !selected.isStarred;
        setSelected({ ...selected, isStarred: next });
        setArticles((current) =>
          current.map((row) =>
            row.id === selected.id ? { ...row, isStarred: next } : row,
          ),
        );
        startTransition(() => {
          void setStarredAction(selected.id, next);
        });
      }
      if (event.key === "m" && selected) {
        event.preventDefault();
        const next = !selected.isRead;
        setSelected({ ...selected, isRead: next });
        setArticles((current) =>
          current.map((row) =>
            row.id === selected.id ? { ...row, isRead: next } : row,
          ),
        );
        startTransition(() => {
          void setReadAction(selected.id, next);
        });
      }
      if (event.key === "r") {
        event.preventDefault();
        startTransition(async () => {
          const result = await refreshAction(props.feedId ?? undefined);
          flash(result.ok ? "ok" : "err", result.message);
          router.refresh();
        });
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flash, go, move, props.feedId, router, selected]);

  const groupedFeeds = useMemo(() => {
    const groups = new Map<string, ReaderProps["feeds"]>();
    for (const feed of props.feeds) {
      const list = groups.get(feed.folder) ?? [];
      list.push(feed);
      groups.set(feed.folder, list);
    }
    return [...groups.entries()];
  }, [props.feeds]);

  const activeFeed = props.feeds.find((feed) => feed.id === props.feedId);

  return (
    <div className="flex h-full min-h-0">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-line bg-ink lg:flex">
        <div className="flex items-center gap-2 px-4 pb-3 pt-5">
          <WaveMark />
          <div>
            <div className="font-medium text-sm text-white tracking-wide">
              Currents
            </div>
            <div className="text-[11px] text-mist/70">
              your river of reading
            </div>
          </div>
        </div>

        <nav className="flex flex-col gap-0.5 px-2">
          <FilterLink
            href={readerHref({
              ...query,
              filter: "all",
              feedId: null,
              articleId: null,
            })}
            active={props.filter === "all" && props.feedId === null}
            label="All"
            count={props.counts.total}
          />
          <FilterLink
            href={readerHref({
              ...query,
              filter: "unread",
              feedId: null,
              articleId: null,
            })}
            active={props.filter === "unread" && props.feedId === null}
            label="Unread"
            count={props.counts.unread}
          />
          <FilterLink
            href={readerHref({
              ...query,
              filter: "starred",
              feedId: null,
              articleId: null,
            })}
            active={props.filter === "starred" && props.feedId === null}
            label="Starred"
            count={props.counts.starred}
          />
        </nav>

        <div className="mt-4 flex items-center justify-between px-4">
          <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-mist/50">
            Feeds
          </span>
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="rounded-md px-1.5 py-0.5 text-[11px] text-foam hover:bg-harbor"
          >
            + add
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4 pt-1">
          {groupedFeeds.length === 0 ? (
            <p className="px-2 py-3 text-xs leading-relaxed text-mist/70">
              No subscriptions yet. Press{" "}
              <kbd className="rounded bg-harbor px-1 text-[10px]">a</kbd> to add
              a feed.
            </p>
          ) : (
            groupedFeeds.map(([folder, feeds]) => (
              <div key={folder} className="mb-3">
                <div className="px-2 pb-1 text-[10px] uppercase tracking-[0.14em] text-mist/40">
                  {folder}
                </div>
                {feeds.map((feed) => (
                  <Link
                    key={feed.id}
                    href={readerHref({
                      ...query,
                      feedId: feed.id,
                      filter: props.filter,
                      articleId: null,
                    })}
                    className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] ${
                      props.feedId === feed.id
                        ? "bg-harbor text-white"
                        : "text-mist hover:bg-slate"
                    }`}
                    title={feed.lastError ?? feed.feedUrl}
                  >
                    <span
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                        feed.lastError
                          ? "bg-warn"
                          : feed.unreadCount > 0
                            ? "bg-foam"
                            : "bg-line"
                      }`}
                    />
                    <span className="min-w-0 flex-1 truncate">
                      {feed.title}
                    </span>
                    {feed.unreadCount > 0 ? (
                      <span className="text-[11px] tabular-nums text-mist/70">
                        {feed.unreadCount}
                      </span>
                    ) : null}
                  </Link>
                ))}
              </div>
            ))
          )}
        </div>

        <div className="flex gap-1 border-t border-line p-2">
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await refreshAction(props.feedId ?? undefined);
                flash(result.ok ? "ok" : "err", result.message);
                router.refresh();
              })
            }
            className="flex-1 rounded-md px-2 py-1.5 text-xs hover:bg-harbor disabled:opacity-50"
          >
            Refresh
          </button>
          <a
            href="/api/opml"
            className="rounded-md px-2 py-1.5 text-xs hover:bg-harbor"
          >
            Export
          </a>
          <button
            type="button"
            onClick={() => setHelpOpen(true)}
            className="rounded-md px-2 py-1.5 text-xs hover:bg-harbor"
          >
            ?
          </button>
        </div>
      </aside>

      <section
        className={`min-w-0 flex-col border-r border-line bg-ink md:w-[26rem] md:shrink-0 ${
          mobilePane === "list" ? "flex w-full" : "hidden md:flex"
        }`}
      >
        <header className="flex items-center gap-2 border-b border-line px-3 py-3">
          <button
            type="button"
            className="rounded-md px-2 py-1 text-xs lg:hidden hover:bg-harbor"
            onClick={() => setAddOpen(true)}
          >
            Feeds
          </button>
          <form
            className="min-w-0 flex-1"
            action="/"
            onSubmit={(event) => {
              event.preventDefault();
              const value = searchRef.current?.value ?? "";
              go({ q: value, articleId: null });
            }}
          >
            <input
              ref={searchRef}
              name="q"
              defaultValue={props.query}
              placeholder="Search everything…"
              className="w-full rounded-md border border-line bg-slate px-3 py-1.5 text-sm text-white outline-none placeholder:text-mist/40 focus:border-foam/40"
            />
          </form>
        </header>

        <div className="flex items-center justify-between gap-2 px-3 py-2 text-[11px] uppercase tracking-[0.14em] text-mist/50">
          <span>
            {activeFeed ? activeFeed.title : filterLabel(props.filter)}
            {props.query ? ` · “${props.query}”` : ""}
          </span>
          <button
            type="button"
            className="normal-case tracking-normal text-mist/70 hover:text-white"
            onClick={() =>
              startTransition(async () => {
                const result = props.feedId
                  ? await markFeedReadAction(props.feedId)
                  : await markAllReadAction();
                flash("ok", result.message);
                router.refresh();
              })
            }
          >
            Mark read
          </button>
        </div>

        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto">
          {articles.length === 0 ? (
            <EmptyState
              hasFeeds={props.feeds.length > 0}
              query={props.query}
              onAdd={() => setAddOpen(true)}
              onStarter={(url) => {
                startTransition(async () => {
                  const data = new FormData();
                  data.set("url", url);
                  const result = await subscribeAction(data);
                  flash(result.ok ? "ok" : "err", result.message);
                  router.refresh();
                });
              }}
            />
          ) : (
            <ul>
              {articles.map((article) => {
                const active = article.id === selected?.id;
                return (
                  <li key={article.id}>
                    <button
                      type="button"
                      onClick={() => selectArticle(article)}
                      className={`flex w-full flex-col gap-1 border-b border-line px-3 py-3 text-left ${
                        active ? "bg-harbor" : "hover:bg-slate/70"
                      }`}
                    >
                      <div className="flex items-center gap-2 text-[11px] text-mist/60">
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${
                            article.isRead ? "bg-line" : "bg-foam"
                          }`}
                        />
                        <span className="truncate">{article.feedTitle}</span>
                        <span className="ml-auto tabular-nums">
                          {formatRelativeTime(article.publishedAt)}
                        </span>
                        {article.isStarred ? (
                          <span className="text-warn">★</span>
                        ) : null}
                      </div>
                      <div
                        className={`text-[15px] leading-snug ${
                          article.isRead ? "text-mist" : "text-white"
                        }`}
                      >
                        {article.title}
                      </div>
                      {article.summary ? (
                        <p className="line-clamp-2 text-[13px] leading-relaxed text-mist/70">
                          {article.summary}
                        </p>
                      ) : null}
                    </button>
                  </li>
                );
              })}
              {nextCursor ? (
                <li
                  data-sentinel
                  className="px-3 py-4 text-center text-xs text-mist/50"
                >
                  {pending ? "Loading…" : "More on the river"}
                </li>
              ) : null}
            </ul>
          )}
        </div>
      </section>

      <article
        className={`min-w-0 flex-1 flex-col bg-[#e9e2d4] ${
          mobilePane === "article" ? "flex" : "hidden md:flex"
        }`}
      >
        {selected ? (
          <>
            <header className="flex items-start gap-3 border-b border-[#d9d0be] px-5 py-4 md:px-10">
              <button
                type="button"
                className="mt-1 rounded-md px-2 py-1 text-xs text-paper-ink/60 md:hidden hover:bg-black/5"
                onClick={() => setMobilePane("list")}
              >
                Back
              </button>
              <div className="min-w-0 flex-1">
                <div className="text-xs text-paper-ink/55">
                  {selected.feedTitle}
                  {selected.author ? ` · ${selected.author}` : ""}
                  {selected.publishedAt
                    ? ` · ${formatAbsoluteTime(selected.publishedAt)}`
                    : ""}
                </div>
                <h1 className="mt-1 font-serif text-2xl font-medium leading-tight text-paper-ink md:text-[2rem]">
                  {selected.title}
                </h1>
              </div>
              <div className="flex shrink-0 gap-1">
                <IconButton
                  label={selected.isStarred ? "Unstar" : "Star"}
                  onClick={() => {
                    const next = !selected.isStarred;
                    setSelected({ ...selected, isStarred: next });
                    startTransition(() => {
                      void setStarredAction(selected.id, next);
                    });
                  }}
                >
                  {selected.isStarred ? "★" : "☆"}
                </IconButton>
                {selected.url ? (
                  <a
                    href={selected.url}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-md px-2 py-1 text-xs text-paper-ink/70 hover:bg-black/5"
                  >
                    Original
                  </a>
                ) : null}
                {activeFeed || selected ? (
                  <IconButton
                    label="Unsubscribe"
                    onClick={() => {
                      const feed =
                        activeFeed ??
                        props.feeds.find((row) => row.id === selected?.feedId);
                      if (!feed) return;
                      if (
                        !window.confirm(
                          `Unsubscribe from ${feed.title}? Stored articles go with it.`,
                        )
                      ) {
                        return;
                      }
                      startTransition(async () => {
                        const result = await unsubscribeAction(feed.id);
                        flash(result.ok ? "ok" : "err", result.message);
                        router.push(
                          readerHref({
                            filter: props.filter,
                            feedId: null,
                            articleId: null,
                            q: props.query,
                          }),
                        );
                      });
                    }}
                  >
                    ×
                  </IconButton>
                ) : null}
              </div>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6 md:px-10 md:py-8">
              {selected.content ? (
                // Bodies are sanitized with an allowlist in src/lib/feed/sanitize.ts before storage.
                <div
                  className="article-body mx-auto max-w-2xl"
                  // biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized article HTML
                  dangerouslySetInnerHTML={{ __html: selected.content }}
                />
              ) : (
                <div className="mx-auto max-w-2xl">
                  {selected.summary ? (
                    <p className="font-serif text-lg leading-relaxed text-paper-ink/80">
                      {selected.summary}
                    </p>
                  ) : (
                    <p className="text-paper-ink/60">
                      This feed only shipped a headline.
                    </p>
                  )}
                  {selected.url ? (
                    <a
                      href={selected.url}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-4 inline-block text-sm text-[#0f5f8a] underline underline-offset-4"
                    >
                      Read on the original site
                    </a>
                  ) : null}
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex h-full flex-col items-center justify-center px-8 text-center text-paper-ink/60">
            <WaveMark dark />
            <p className="mt-4 max-w-sm font-serif text-xl text-paper-ink">
              The river is quiet.
            </p>
            <p className="mt-2 max-w-sm text-sm">
              Add a feed, or pick an article from the list. Press{" "}
              <kbd className="rounded bg-black/10 px-1">?</kbd> for shortcuts.
            </p>
          </div>
        )}
      </article>

      {addOpen ? (
        <AddFeedDialog
          folders={props.folders}
          pending={pending}
          onClose={() => setAddOpen(false)}
          onResult={(result) => {
            flash(result.ok ? "ok" : "err", result.message);
            if (result.ok) {
              setAddOpen(false);
              router.refresh();
            }
          }}
        />
      ) : null}

      {helpOpen ? <HelpDialog onClose={() => setHelpOpen(false)} /> : null}

      {toast ? (
        <div
          className={`fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-full px-4 py-2 text-sm shadow-lg ${
            toast.kind === "ok"
              ? "bg-harbor text-white"
              : "bg-danger text-abyss"
          }`}
        >
          {toast.text}
        </div>
      ) : null}
    </div>
  );
}

function filterLabel(filter: ArticleFilter): string {
  if (filter === "unread") return "Unread";
  if (filter === "starred") return "Starred";
  return "All articles";
}

function FilterLink({
  href,
  active,
  label,
  count,
}: {
  href: Route;
  active: boolean;
  label: string;
  count: number;
}) {
  return (
    <Link
      href={href}
      className={`flex items-center justify-between rounded-md px-2 py-1.5 text-[13px] ${
        active ? "bg-harbor text-white" : "hover:bg-slate"
      }`}
    >
      <span>{label}</span>
      <span className="tabular-nums text-[11px] text-mist/70">{count}</span>
    </Link>
  );
}

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className="rounded-md px-2 py-1 text-sm text-paper-ink/70 hover:bg-black/5"
    >
      {children}
    </button>
  );
}

function WaveMark({ dark = false }: { dark?: boolean }) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={dark ? "text-paper-ink/70" : "text-foam"}
    >
      <path
        fill="currentColor"
        d="M3 15c2.2-2.4 4.2-2.4 6 0s3.8 2.4 6 0 3.8-2.4 6 0v2c-2.2-2.4-4.2-2.4-6 0s-3.8 2.4-6 0-3.8-2.4-6 0zm0-6c2.2-2.4 4.2-2.4 6 0s3.8 2.4 6 0 3.8-2.4 6 0v2c-2.2-2.4-4.2-2.4-6 0s-3.8 2.4-6 0-3.8-2.4-6 0z"
      />
    </svg>
  );
}

function EmptyState({
  hasFeeds,
  query,
  onAdd,
  onStarter,
}: {
  hasFeeds: boolean;
  query: string;
  onAdd: () => void;
  onStarter: (url: string) => void;
}) {
  if (query) {
    return (
      <div className="px-6 py-12 text-center text-sm text-mist/70">
        Nothing in the archive matches “{query}”.
      </div>
    );
  }
  if (hasFeeds) {
    return (
      <div className="px-6 py-12 text-center text-sm text-mist/70">
        No articles in this view. Refresh, or switch to All.
      </div>
    );
  }
  return (
    <div className="px-5 py-8">
      <p className="font-serif text-lg text-white">Start a current.</p>
      <p className="mt-1 text-sm text-mist/70">
        Paste any blog URL — Currents will find the feed — or tap one of these.
      </p>
      <ul className="mt-4 flex flex-col gap-2">
        {STARTER_FEEDS.map((feed) => (
          <li key={feed.url}>
            <button
              type="button"
              onClick={() => onStarter(feed.url)}
              className="w-full rounded-lg border border-line bg-slate px-3 py-2 text-left hover:border-foam/30"
            >
              <div className="text-sm text-white">{feed.title}</div>
              <div className="text-xs text-mist/60">{feed.blurb}</div>
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={onAdd}
        className="mt-4 text-sm text-foam hover:underline"
      >
        Or paste your own URL
      </button>
    </div>
  );
}

function AddFeedDialog({
  folders,
  pending,
  onClose,
  onResult,
}: {
  folders: string[];
  pending: boolean;
  onClose: () => void;
  onResult: (result: { ok: boolean; message: string }) => void;
}) {
  const [tab, setTab] = useState<"url" | "opml">("url");

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close dialog"
        className="absolute inset-0 bg-black/60"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-feed-title"
        className="relative z-10 w-full max-w-md rounded-2xl border border-line bg-ink p-5 shadow-2xl"
      >
        <div className="flex items-center justify-between">
          <h2 id="add-feed-title" className="text-sm font-medium text-white">
            Add feeds
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-mist hover:text-white"
          >
            Esc
          </button>
        </div>
        <div className="mt-3 flex gap-2 text-xs">
          <button
            type="button"
            onClick={() => setTab("url")}
            className={`rounded-full px-3 py-1 ${
              tab === "url" ? "bg-harbor text-white" : "hover:bg-slate"
            }`}
          >
            URL
          </button>
          <button
            type="button"
            onClick={() => setTab("opml")}
            className={`rounded-full px-3 py-1 ${
              tab === "opml" ? "bg-harbor text-white" : "hover:bg-slate"
            }`}
          >
            OPML
          </button>
        </div>

        {tab === "url" ? (
          <form
            className="mt-4 flex flex-col gap-3"
            action={async (formData) => {
              const result = await subscribeAction(formData);
              onResult(result);
            }}
          >
            <label className="text-xs text-mist/70">
              Feed or homepage
              <input
                required
                name="url"
                type="url"
                placeholder="https://example.com"
                className="mt-1 w-full rounded-md border border-line bg-slate px-3 py-2 text-sm text-white outline-none focus:border-foam/40"
              />
            </label>
            <label className="text-xs text-mist/70">
              Folder
              <input
                name="folder"
                list="folder-list"
                placeholder="Unsorted"
                className="mt-1 w-full rounded-md border border-line bg-slate px-3 py-2 text-sm text-white outline-none focus:border-foam/40"
              />
            </label>
            <datalist id="folder-list">
              {folders.map((folder) => (
                <option key={folder} value={folder} />
              ))}
            </datalist>
            <button
              type="submit"
              disabled={pending}
              className="rounded-md bg-foam px-3 py-2 text-sm font-medium text-abyss disabled:opacity-50"
            >
              Subscribe
            </button>
          </form>
        ) : (
          <form
            className="mt-4 flex flex-col gap-3"
            action={async (formData) => {
              const result = await importOpmlAction(formData);
              onResult(result);
            }}
          >
            <label className="text-xs text-mist/70">
              OPML file
              <input
                required
                name="opml"
                type="file"
                accept=".opml,application/xml,text/xml"
                className="mt-1 w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-harbor file:px-3 file:py-1.5 file:text-white"
              />
            </label>
            <p className="text-xs text-mist/60">
              Exports from NetNewsWire, MiniFlux, Feedly, and most other readers
              work.
            </p>
            <button
              type="submit"
              disabled={pending}
              className="rounded-md bg-foam px-3 py-2 text-sm font-medium text-abyss disabled:opacity-50"
            >
              Import
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

function HelpDialog({ onClose }: { onClose: () => void }) {
  const rows = [
    ["j / k", "Next / previous article"],
    ["o / enter", "Open original"],
    ["s", "Star"],
    ["m", "Toggle read"],
    ["r", "Refresh"],
    ["/", "Search"],
    ["a", "Add a feed"],
    ["1 2 3", "All / unread / starred"],
    ["?", "This panel"],
  ];
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close shortcuts"
        className="absolute inset-0 bg-black/60"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-title"
        className="relative z-10 w-full max-w-sm rounded-2xl border border-line bg-ink p-5"
      >
        <h2 id="help-title" className="text-sm font-medium text-white">
          Keyboard
        </h2>
        <div className="mt-3 grid grid-cols-[7rem_1fr] gap-y-2 text-sm">
          {rows.map(([key, meaning]) => (
            <div key={key} className="contents">
              <dt className="font-mono text-xs text-foam">{key}</dt>
              <dd className="text-mist">{meaning}</dd>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
