import type { Metadata } from "next"

import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

export const metadata: Metadata = {
  title: "Next.js Starter",
  description: "A minimal Next.js starter template.",
}

export default function Page() {
  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="flex items-center gap-2">
            <CardTitle>Next.js Starter</CardTitle>
            <Badge variant="secondary">Ready</Badge>
          </div>
          <CardDescription>
            TypeScript, Tailwind CSS 4, and shadcn/ui are configured. Replace
            this page with your app.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          <p>
            Run <code className="text-foreground">pnpm dev</code> to start the
            dev server. Press <kbd>d</kbd> to toggle dark mode.
          </p>
        </CardContent>
      </Card>
    </main>
  )
}
