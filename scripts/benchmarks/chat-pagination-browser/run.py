"""Measure the real production-built sidebar against synthetic page responses.
Requires Python Playwright and a local Chrome installation; no customer sessions.
"""
import argparse
import json
import math
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright

parser = argparse.ArgumentParser()
parser.add_argument("--url", default="http://127.0.0.1:4464")
parser.add_argument("--output", default="/tmp/chat-pagination-browser.json")
parser.add_argument("--cpu", default="1,4")
parser.add_argument("--scenarios", default="normal,sparse-unread,mixed,sparse-account")
args = parser.parse_args()
preview = urlsplit(args.url)
if (preview.scheme, preview.hostname, preview.port) != ("http", "127.0.0.1", 4464) or preview.username or preview.password or preview.path not in ("", "/") or preview.query or preview.fragment:
    raise ValueError("Only the local benchmark preview is supported")
args.url = args.url.rstrip("/")


def percentile(values, p):
    return round(sorted(values)[max(0, math.ceil(len(values) * p) - 1)], 2) if values else 0


def snapshot(page):
    return page.evaluate("chatBenchmark.snapshot()")


def wait_idle(page):
    page.wait_for_function("window.chatBenchmark && chatBenchmark.snapshot().isFetching === 0 && !chatBenchmark.snapshot().pendingRefresh", timeout=120000)
    page.wait_for_timeout(100)


def contact_rows(page):
    return page.evaluate("chatBenchmark.snapshot().cached.find(q => q.key[0] === 'chats' && q.key.at(-1).assignmentFilter === 'all')?.rows ?? 0")


def contact_progress(page):
    return page.evaluate("chatBenchmark.snapshot().cached.find(q => q.key[0] === 'chats' && q.key.at(-1).assignmentFilter === 'all')?.endOffset ?? 0")


def load_until(page, count):
    while contact_progress(page) < count:
        before = contact_progress(page)
        page.locator('[role="listbox"]').evaluate("el => { el.scrollTop = el.scrollHeight; }")
        page.wait_for_function("before => (chatBenchmark.snapshot().cached.find(q => q.key[0] === 'chats' && q.key.at(-1).assignmentFilter === 'all')?.endOffset ?? 0) > before", arg=before, timeout=120000)
        wait_idle(page)


def heap(cdp):
    cdp.send("HeapProfiler.collectGarbage")
    metrics = {entry["name"]: entry["value"] for entry in cdp.send("Performance.getMetrics")["metrics"]}
    return {"heapUsedMiB": round(metrics["JSHeapUsedSize"] / 1024 ** 2, 2), "heapTotalMiB": round(metrics["JSHeapTotalSize"] / 1024 ** 2, 2)}


def request_stats(state):
    requests = [req for req in state["requests"] if req["endpoint"] in ("contacts", "conversations")]
    return {"requests": len(requests), "contactsRequests": sum(req["endpoint"] == "contacts" for req in requests), "channelRequests": sum(req["endpoint"] == "conversations" for req in requests), "aborted": sum(bool(req.get("aborted")) for req in requests), "responseMiB": round(sum(req.get("bytes", 0) for req in requests) / 1024 ** 2, 3), "longTasks": len(state["longTasks"]), "maxLongTaskMs": round(max(state["longTasks"], default=0), 2)}


def scroll_measure(page, cdp):
    before = {entry["name"]: entry["value"] for entry in cdp.send("Performance.getMetrics")["metrics"]}
    page.evaluate("chatBenchmark.clearMetrics()")
    frames = page.evaluate("""async () => {
      const list = document.querySelector('[role="listbox"]');
      const max = (list.scrollHeight - list.clientHeight) * .6;
      const min = (list.scrollHeight - list.clientHeight) * .1;
      list.scrollTop = min;
      const intervals = [];
      let previous;
      await new Promise(resolve => {
        let count = 0;
        function tick(now) {
          if (previous !== undefined) intervals.push(now - previous);
          previous = now;
          list.scrollTop = min + max * (1 - Math.cos(count / 30)) / 2;
          if (++count >= 180) resolve(); else requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
      });
      return intervals;
    }""")
    after = {entry["name"]: entry["value"] for entry in cdp.send("Performance.getMetrics")["metrics"]}
    state = snapshot(page)
    return {"frames": len(frames), "frameP50Ms": percentile(frames, .5), "frameP95Ms": percentile(frames, .95), "frameP99Ms": percentile(frames, .99), "framesOver25Ms": sum(frame > 25 for frame in frames), "mainThreadTaskMs": round((after["TaskDuration"] - before["TaskDuration"]) * 1000, 2), "renderedRows": state["renderedRows"], "domNodes": state["domNodes"], **request_stats(state)}


def validate_window_navigation(page):
    page.locator('[role="listbox"]').evaluate("el => { el.scrollTop = el.scrollHeight * .15; }")
    page.wait_for_timeout(100)
    anchor = page.evaluate("""() => {
      const root = document.querySelector('[role="listbox"]').getBoundingClientRect();
      const row = [...document.querySelectorAll('[data-chat-id]')].find(el => el.getBoundingClientRect().bottom > root.top);
      return {id: row.dataset.chatId, top: row.getBoundingClientRect().top - root.top};
    }""")
    before = snapshot(page)["cached"][0]["firstOffset"]
    page.get_by_role("button", name="Load newer chats", exact=True).click()
    wait_idle(page)
    after = snapshot(page)["cached"][0]["firstOffset"]
    delta = page.evaluate("""anchor => {
      const root = document.querySelector('[role="listbox"]').getBoundingClientRect();
      const row = [...document.querySelectorAll('[data-chat-id]')].find(el => el.dataset.chatId === anchor.id);
      return row ? row.getBoundingClientRect().top - root.top - anchor.top : null;
    }""", anchor)
    if after >= before or delta is None or abs(delta) > 2:
        raise AssertionError(f"Backward pagination lost anchor: {before=} {after=} {delta=}")
    page.get_by_role("button", name="Back to latest", exact=True).click()
    wait_idle(page)
    if any(query["firstOffset"] != 0 for query in snapshot(page)["cached"]):
        raise AssertionError("Back to latest failed to reset page offsets")
    return {"previousOffset": before, "newOffset": after, "anchorShiftPx": delta, "backToLatestPassed": True}


results = []
with sync_playwright() as p:
    browser = p.chromium.launch(channel="chrome", headless=True, args=["--disable-background-networking"])
    version = browser.version
    for cpu in [int(value) for value in args.cpu.split(",")]:
        for scenario in args.scenarios.split(","):
            if scenario not in ("normal", "sparse-unread", "mixed", "sparse-account"):
                raise ValueError(f"Unknown scenario: {scenario}")
            context = browser.new_context(viewport={"width": 1280, "height": 960}, service_workers="block")
            # All real browser network access stays on the local static preview.
            context.route("**/*", lambda route: route.continue_() if route.request.url.startswith(args.url + "/") else route.abort())
            page = context.new_page()
            errors = []
            page.on("pageerror", lambda error: errors.append(str(error)))
            cdp = context.new_cdp_session(page)
            cdp.send("Performance.enable")
            cdp.send("Emulation.setCPUThrottlingRate", {"rate": cpu})
            total = 1000 if scenario == "mixed" else 10000
            suffix = "&sparseUnread=1" if scenario == "sparse-unread" else "&channels=1000" if scenario == "mixed" else "&channels=1000&sparseAccount=1" if scenario == "sparse-account" else ""
            started = time.perf_counter()
            page.goto(f"{args.url}/?total={total}&delay=40{suffix}")
            page.get_by_role("option").first.wait_for(timeout=30000)
            wait_idle(page)
            result = {"scenario": scenario, "cpuThrottle": cpu, "syntheticRttMs": 40, "initialReadyMs": round((time.perf_counter() - started) * 1000, 2), "initial": {**heap(cdp), "renderedRows": snapshot(page)["renderedRows"], **request_stats(snapshot(page))}}
            if scenario == "normal":
                result["checkpoints"] = []
                for count in [1000, 10000]:
                    start = time.perf_counter()
                    load_until(page, count)
                    state = snapshot(page)
                    result["checkpoints"].append({"visitedContacts": contact_progress(page), "cachedContacts": contact_rows(page), "loadElapsedMs": round((time.perf_counter() - start) * 1000, 2), **heap(cdp), "renderedRows": state["renderedRows"], "domNodes": state["domNodes"]})
                result["scroll"] = scroll_measure(page, cdp)
                page.evaluate("chatBenchmark.clearMetrics()")
                start = time.perf_counter()
                page.evaluate("chatBenchmark.invalidate()")
                wait_idle(page)
                result["singleInvalidation"] = {"elapsedMs": round((time.perf_counter() - start) * 1000, 2), **request_stats(snapshot(page))}
                page.evaluate("chatBenchmark.clearMetrics()")
                start = time.perf_counter()
                for i in range(5):
                    page.evaluate("chatBenchmark.invalidate()")
                    if i < 4:
                        page.wait_for_timeout(150)
                wait_idle(page)
                result["fiveInvalidations150msApart"] = {"elapsedMs": round((time.perf_counter() - start) * 1000, 2), **request_stats(snapshot(page))}
                result["navigation"] = validate_window_navigation(page)
            elif scenario == "sparse-unread":
                page.evaluate("chatBenchmark.clearMetrics()")
                start = time.perf_counter()
                page.get_by_role("button", name="Unread", exact=True).click()
                page.wait_for_function("chatBenchmark.snapshot().cached.some(q => q.key[0] === 'chats' && q.key.at(-1).assignmentFilter === 'unread' && q.rows >= 10)", timeout=120000)
                wait_idle(page)
                result["findTenOldUnreadChats"] = {"elapsedMs": round((time.perf_counter() - start) * 1000, 2), **heap(cdp), **request_stats(snapshot(page))}
            elif scenario == "sparse-account":
                # Start with an evicted all-account window, like the reported
                # bug, then pick a Telegram account with only two old rows.
                load_until(page, 1000)
                result["accountFilters"] = []
                for label, account, rows in [
                    ("Sparse Telegram", "00000000-0000-4000-8000-000000000004", 2),
                    ("Empty Telegram", "00000000-0000-4000-8000-000000000005", 0),
                ]:
                    page.evaluate("chatBenchmark.clearMetrics()")
                    page.get_by_role("combobox").click()
                    page.get_by_role("option").filter(has_text=label).click()
                    wait_idle(page)
                    page.wait_for_timeout(1000)  # allow repeated footer callbacks
                    state = snapshot(page)
                    scoped = [q for q in state["cached"] if q["active"]]
                    requests = [r for r in state["requests"] if r["endpoint"] in ("contacts", "conversations")]
                    if len(requests) != 2 or any(r["offset"] != 0 or r["channelAccountId"] != account for r in requests):
                        raise AssertionError(f"Account filter scanned unrelated pages: {requests}")
                    if sum(q["rows"] for q in scoped) != rows or any(q["firstOffset"] != 0 for q in scoped):
                        raise AssertionError(f"Account filter retained unrelated window: {scoped}")
                    if state["renderedRows"] != rows or page.get_by_role("button", name="Load newer chats", exact=True).count():
                        raise AssertionError("Sparse account has incorrect rows or phantom previous pages")
                    page.evaluate("chatBenchmark.clearMetrics(); chatBenchmark.invalidate()")
                    wait_idle(page)
                    page.wait_for_timeout(1000)
                    refresh = [r for r in snapshot(page)["requests"] if r["endpoint"] in ("contacts", "conversations")]
                    if len(refresh) != 2 or any(r["offset"] != 0 or r["channelAccountId"] != account for r in refresh):
                        raise AssertionError(f"Realtime refresh escaped account scope: {refresh}")
                    result["accountFilters"].append({"label": label, "rows": rows, "initialRequests": len(requests), "refreshRequests": len(refresh)})
                for label in ["Synthetic WhatsApp", "All accounts"]:
                    page.get_by_role("combobox").click()
                    page.get_by_role("option").filter(has_text=label).click()
                    wait_idle(page)
                    active = [q for q in snapshot(page)["cached"] if q["active"]]
                    if any(q["firstOffset"] != 0 for q in active) or snapshot(page)["renderedRows"] == 0:
                        raise AssertionError(f"Returning to {label} did not restore the head")
                result["switchBackPassed"] = True
            else:
                page.evaluate("chatBenchmark.clearMetrics()")
                load_until(page, 1000)
                state = snapshot(page)
                result["loadedMixed"] = {"cachedSources": state["cached"], **heap(cdp), "renderedRows": state["renderedRows"], **request_stats(state)}
                result["navigation"] = validate_window_navigation(page)
            result["pageErrors"] = errors
            if errors:
                raise AssertionError(f"Browser errors in {scenario}: {errors}")
            if snapshot(page)["renderedRows"] > 30:
                raise AssertionError("Virtualized row count exceeded the viewport buffer")
            results.append(result)
            print(json.dumps(result), flush=True)
            context.close()
    browser.close()
output = {"measuredAt": datetime.now(timezone.utc).isoformat(), "browser": version, "scope": "Actual ChatList and auth/workspace/query providers in an optimized Vite build; synthetic in-browser fetch with 40ms delay, no avatar images, no live sockets; isolated sidebar, not full app. Heap measured after forced GC. Headless frame timing is not a real-device UX guarantee.", "results": results}
Path(args.output).write_text(json.dumps(output, indent=2))
print(f"Saved {args.output}")
