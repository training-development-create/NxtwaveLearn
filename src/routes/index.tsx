import { createFileRoute } from "@tanstack/react-router";
import { LDApp } from "@/components/ld/App";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "NxtWave — Compliance Training Portal" },
      { name: "description", content: "Compliance Training Portal: required compliance courses, video lessons, compliance assessments, signed agreements, and admin analytics." },
      { property: "og:title", content: "NxtWave — Compliance Training Portal" },
      { property: "og:description", content: "Watch the compliance training. Complete the assessment. Sign required agreements." },
    ],
  }),
  component: () => <LDApp/>,
});
