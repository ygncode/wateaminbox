import importlib.util
import pathlib
import sys
import tempfile
import textwrap
import unittest


SCRIPT = pathlib.Path(__file__).with_name("generate-api-docs.py")
SPEC = importlib.util.spec_from_file_location("generate_api_docs", SCRIPT)
generator = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = generator
SPEC.loader.exec_module(generator)


class DescriptionTests(unittest.TestCase):
    def test_route_params_and_hyphens_do_not_consume_description(self):
        cases = {
            "POST /bulk-jobs/:job-id/reschedule - Move the job": "Move the job",
            "GET /contacts/:contact-id: Fetch the contact": "Fetch the contact",
            "DELETE /groups/:id/join-requests/:request-id — Reject request": "Reject request",
        }
        for raw, expected in cases.items():
            with self.subTest(raw=raw):
                self.assertEqual(generator.clean_desc(raw), expected)


class AccessLabelTests(unittest.TestCase):
    def test_all_guard_families_and_tenant_role_are_labeled(self):
        labels = generator.access_labels(
            'authMiddleware tenantFromParam("company-id", "owner") '
            "requirePermission(PERMISSIONS.CAN_MANAGE_TEAM) "
            "requireMessageVisibility() requireMessageSendPermission "
            "messageSendRateLimiter"
        )
        self.assertEqual(
            labels,
            [
                "Authenticated",
                "Tenant context",
                "`can_manage_team`",
                "Owner role",
                "Message visibility",
                "`can_send_messages`",
                "Rate limited",
            ],
        )


class ActualRouteAccessTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.endpoints = {
            (method, path): access
            for path, method, _description, access, _source
            in generator.RouteGraph().rows()
        }

    def test_public_and_authenticated_endpoints_are_distinct(self):
        self.assertEqual(self.endpoints[("get", "/invitations/:token")], ["Public"])
        self.assertEqual(
            self.endpoints[("post", "/invitations/:token/accept")],
            ["Authenticated"],
        )

    def test_owner_role_from_tenant_param_is_propagated(self):
        access = self.endpoints[
            ("patch", "/companies/:id/members/:userId/permissions")
        ]
        self.assertIn("Authenticated", access)
        self.assertIn("Tenant context", access)
        self.assertIn("Owner role", access)

    def test_group_router_guards_are_method_and_path_scoped(self):
        listing = self.endpoints[("get", "/groups")]
        mutation = self.endpoints[("post", "/groups/:id/participants/remove")]
        self.assertNotIn("Contact visibility", listing)
        self.assertNotIn("`can_send_messages`", listing)
        self.assertIn("Contact visibility", mutation)
        self.assertIn("`can_send_messages`", mutation)

    def test_permission_visibility_send_and_rate_guards_are_propagated(self):
        self.assertIn(
            "`can_manage_connections`",
            self.endpoints[("get", "/catalogs")],
        )
        message = self.endpoints[("post", "/messages/:id/forward")]
        self.assertIn("Message visibility", message)
        self.assertIn("`can_send_messages`", message)
        self.assertIn("Rate limited", message)

    def test_handler_level_access_overrides_are_applied(self):
        expected = {
            ("get", "/conversations/stats/resolution"): "`can_view_dashboard`",
            ("post", "/search/reindex"): "Admin role",
            ("patch", "/companies/:id"): "Owner role when changing status",
            ("post", "/contacts/:id/assign"): "Conditional `can_assign_contacts` (other-user assignment or takeover)",
            ("put", "/contacts/:id/notes/shared/:noteId"): "Author only",
            ("get", "/messages"): "Contact visibility (result-filtered)",
            ("post", "/messages/batch/star"): "Message visibility (all selected)",
            ("post", "/actions/messages/read"): "Contact visibility",
            ("delete", "/status/:id"): "Creator only",
        }
        for endpoint, label in expected.items():
            with self.subTest(endpoint=endpoint):
                self.assertIn(label, self.endpoints[endpoint])

    def test_documented_route_count_is_stable(self):
        self.assertEqual(len(self.endpoints), 227)


class RenderedAccuracyTests(unittest.TestCase):
    def test_high_risk_description_overrides(self):
        items = [
            ("", "post", "/messages", "wrong", ["Authenticated"]),
            ("", "post", "/actions/messages/send", "wrong", ["Authenticated"]),
            ("", "get", "/debug/nats/messages/:stream", "wrong", ["Public"]),
        ]
        table = generator.endpoint_table(items)
        self.assertIn("pending message (200)", table)
        self.assertIn("always returns 410", table)
        self.assertIn("not message content", table)

    def test_hand_authored_flows_preserve_audited_contracts(self):
        content = "\n".join(
            group["overview"] + "\n" + "\n".join(flow for _, flow in group["flows"])
            for group in generator.GROUPS
        )
        for required in (
            "A-->>U: 200 {message (pending)}",
            "N->>W: worker consumes command directly",
            "Creation performs no immediate NATS fanout",
            "A-->>U: 201 {summary, results, connection}",
            "subscribe company:{companyId} + user:{companyId}:{userId} only",
            "503 only when core checks are unready",
        ):
            with self.subTest(required=required):
                self.assertIn(required, content)
        self.assertNotIn("A->>D: stream rows", content)
        self.assertNotIn("A->>D: hydrate results", content)


class RouteGraphTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.base = pathlib.Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def write(self, relative, source):
        path = self.base / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(textwrap.dedent(source))

    def test_nested_mounts_propagate_only_matching_prior_guards(self):
        self.write(
            "index.ts",
            """
            import { Hono } from "hono";
            import { itemRoutes } from "./items/index.js";
            export const routes = new Hono();
            routes.route("/items", itemRoutes);
            routes.get("/", (c) => c.text("ok"));
            """,
        )
        self.write(
            "items/index.ts",
            """
            import { Hono } from "hono";
            import { leafRoutes } from "./leaf.js";
            export const itemRoutes = new Hono();
            itemRoutes.use("/*", authMiddleware);
            itemRoutes.use("/*", tenantMiddleware());
            itemRoutes.use("/:id/*", requireContactVisibility());
            itemRoutes.post("/:id/*", requireMessageSendPermission);
            itemRoutes.route("/nested", leafRoutes);
            """,
        )
        self.write(
            "items/leaf.ts",
            """
            import { Hono } from "hono";
            export const leafRoutes = new Hono();
            leafRoutes.get(
              "/:id/view",
              requirePermission(PERMISSIONS.CAN_VIEW_DASHBOARD),
              searchRateLimiter,
              async (c) => c.json({ ok: true }),
            );
            leafRoutes.post("/:id/send", async (c) => c.json({ ok: true }));
            """,
        )

        rows = generator.RouteGraph(self.base).rows()
        by_route = {(method, path): labels for path, method, _, labels, _ in rows}
        self.assertEqual(by_route[("get", "/")], ["Public"])
        self.assertEqual(
            by_route[("get", "/items/nested/:id/view")],
            [
                "Authenticated",
                "Tenant context",
                "`can_view_dashboard`",
                "Contact visibility",
                "Rate limited",
            ],
        )
        self.assertEqual(
            by_route[("post", "/items/nested/:id/send")],
            [
                "Authenticated",
                "Tenant context",
                "Contact visibility",
                "`can_send_messages`",
            ],
        )
        self.assertNotIn("`can_send_messages`", by_route[("get", "/items/nested/:id/view")])

    def test_local_export_alias_does_not_change_internal_mount(self):
        self.write(
            "index.ts",
            """
            import { Hono } from "hono";
            import { combinedRoutes, publicRoutes } from "./combined.js";
            export const routes = new Hono();
            routes.route("/combined", combinedRoutes);
            routes.route("/public", publicRoutes);
            """,
        )
        self.write(
            "combined.ts",
            """
            export { combinedRoutes, publicRoutes } from "./nested/index.js";
            """,
        )
        self.write(
            "nested/index.ts",
            """
            import { Hono } from "hono";
            import { privateRoutes, tokenRoutes } from "./leaves.js";
            export const combinedRoutes = new Hono();
            combinedRoutes.route("/", privateRoutes);
            export { tokenRoutes as publicRoutes };
            """,
        )
        self.write(
            "nested/leaves.ts",
            """
            import { Hono } from "hono";
            export const privateRoutes = new Hono();
            export const tokenRoutes = new Hono();
            privateRoutes.get("/private", authMiddleware, async (c) => c.text("private"));
            tokenRoutes.get("/:token", async (c) => c.text("public"));
            """,
        )

        routes = {(method, path) for path, method, *_ in generator.RouteGraph(self.base).rows()}
        self.assertEqual(routes, {("get", "/combined/private"), ("get", "/public/:token")})

    def test_unmounted_route_bearing_file_fails_closed(self):
        self.write(
            "index.ts",
            """
            import { Hono } from "hono";
            export const routes = new Hono();
            routes.get("/", (c) => c.text("ok"));
            """,
        )
        self.write(
            "orphan.ts",
            """
            import { Hono } from "hono";
            export const orphanRoutes = new Hono();
            orphanRoutes.get("/lost", async (c) => c.text("lost"));
            """,
        )

        with self.assertRaisesRegex(ValueError, r"unaccounted route-bearing routers: orphan\.ts:orphanRoutes"):
            generator.RouteGraph(self.base).rows()


if __name__ == "__main__":
    unittest.main()
