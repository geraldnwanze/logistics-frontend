import type { Metadata } from "next";
import { Suspense } from "react";
import { Container } from "@/components/blocks/shared";
import { TrackingForm } from "@/components/blocks/tracking-widget";
import { TrackingResult } from "@/components/tracking/tracking-result";

export const metadata: Metadata = { title: "Track shipment", robots: { index: false } };

export default function TrackPage({ params }: { params: Promise<{ number: string }> }) {
  return (
    <Suspense fallback={null}>
      <TrackResult params={params} />
    </Suspense>
  );
}

async function TrackResult({ params }: { params: Promise<{ number: string }> }) {
  const { number } = await params;
  const shown = safeDecode(number);

  return (
    <Container className="max-w-2xl py-16">
      <h1 className="text-3xl font-semibold">Track shipment</h1>
      <TrackingResult number={shown} />
      <div className="mt-10"><TrackingForm /></div>
    </Container>
  );
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
