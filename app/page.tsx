import type { Metadata } from "next";
import SquiggleCanvas from "@/components/SquiggleCanvas";

export const metadata: Metadata = {
  title: "Squiggle Studio",
  description: "Freehand ribbon-style squiggle drawing tool",
};

export default function Home() {
  return <SquiggleCanvas />;
}
