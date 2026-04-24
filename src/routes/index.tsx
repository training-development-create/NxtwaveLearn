import { createFileRoute } from "@tanstack/react-router";
import { LDApp } from "@/components/ld/App";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "NxtWave — Employee L&D Portal" },
      { name: "description", content: "Employee learning portal: required training, video lessons, assessments, certificates, and admin analytics." },
      { property: "og:title", content: "NxtWave — Employee L&D Portal" },
      { property: "og:description", content: "Watch the training. Pass the quick assessment. Certificate issued automatically." },
    ],
  }),
  component: () => <LDApp/>,
});
