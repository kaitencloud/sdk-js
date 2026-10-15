import * as React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";

import { ProgressBar } from "../shared/progress-bar.tsx";
import { Badge } from "./badge.tsx";
import { Button } from "./button.tsx";
import { Checkbox } from "./checkbox.tsx";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "./card.tsx";
import { Dialog, DialogDescription, DialogTitle } from "./dialog.tsx";
import { Input } from "./input.tsx";
import { Separator } from "./separator.tsx";
import { Skeleton } from "./skeleton.tsx";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./table.tsx";

const meta: Meta = {
  title: "UI/Primitives",
  parameters: {
    layout: "padded",
  },
};

export default meta;

type Story = StoryObj<typeof meta>;

export const Buttons: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Button>Primary</Button>
      <Button variant="secondary">Secondary</Button>
      <Button variant="outline">Outline</Button>
      <Button variant="ghost">Ghost</Button>
      <Button variant="destructive">Destructive</Button>
    </div>
  ),
};

export const ButtonDisabled: Story = {
  name: "Button (disabled)",
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Button disabled>Primary</Button>
      <Button variant="secondary" disabled>
        Secondary
      </Button>
      <Button variant="outline" disabled>
        Outline
      </Button>
      <Button variant="ghost" disabled>
        Ghost
      </Button>
      <Button variant="destructive" disabled>
        Destructive
      </Button>
    </div>
  ),
};

export const Badges: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Badge>Default</Badge>
      <Badge variant="secondary">Secondary</Badge>
      <Badge variant="success">Active</Badge>
      <Badge variant="destructive">Blocked</Badge>
      <Badge variant="outline">Outline</Badge>
    </div>
  ),
};

export const Cards: Story = {
  render: () => (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>Current plan</CardTitle>
        <CardDescription>Matches the app card shell and token set.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 text-sm text-muted-foreground">
        <p>Pro license</p>
        <p>10,000 API calls included</p>
      </CardContent>
      <CardFooter>
        <Button size="sm">Manage</Button>
      </CardFooter>
    </Card>
  ),
};

export const Separators: Story = {
  name: "Separator",
  render: () => (
    <div className="w-full max-w-md rounded-lg border border-border p-4">
      <p className="text-sm font-medium">Usage summary</p>
      <Separator className="my-4" />
      <p className="text-sm text-muted-foreground">8,420 / 10,000 API calls</p>
    </div>
  ),
};

export const Skeletons: Story = {
  name: "Skeleton",
  render: () => (
    <div className="w-full max-w-md space-y-3 rounded-lg border border-border p-4">
      <Skeleton className="h-5 w-1/3" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-5/6" />
      <Skeleton className="h-9 w-32" />
    </div>
  ),
};

export const Tables: Story = {
  name: "Table",
  render: () => (
    <div className="w-full max-w-2xl rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Entitlement</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Value</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell className="font-medium">API calls</TableCell>
            <TableCell>
              <Badge variant="success">Healthy</Badge>
            </TableCell>
            <TableCell className="text-right">8,420 / 10,000</TableCell>
          </TableRow>
          <TableRow>
            <TableCell className="font-medium">Audit logs</TableCell>
            <TableCell>
              <Badge variant="secondary">Included</Badge>
            </TableCell>
            <TableCell className="text-right">Enabled</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  ),
};

export const Inputs: Story = {
  name: "Input",
  render: () => (
    <div className="w-full max-w-md space-y-3">
      <label className="block space-y-2 text-sm">
        <span className="font-medium">License key</span>
        <Input defaultValue="trial-key" />
      </label>
      <label className="block space-y-2 text-sm">
        <span className="font-medium">Readonly</span>
        <Input readOnly value="pk_storybook" />
      </label>
    </div>
  ),
};

export const Checkboxes: Story = {
  name: "Checkbox",
  render: () => (
    <div className="flex w-full max-w-md flex-col gap-3 text-sm">
      <label className="flex w-fit cursor-pointer items-center gap-2">
        <Checkbox /> Not ticked
      </label>
      <label className="flex w-fit cursor-pointer items-center gap-2">
        <Checkbox defaultChecked /> Ticked
      </label>
      <label className="flex w-fit cursor-not-allowed items-center gap-2">
        <Checkbox disabled /> Disabled
      </label>
      <label className="flex w-fit cursor-not-allowed items-center gap-2">
        <Checkbox disabled defaultChecked /> Disabled and ticked
      </label>
      <label className="flex w-fit cursor-pointer items-center gap-2">
        <Checkbox aria-invalid /> Invalid
      </label>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const first = canvas.getByRole("checkbox", { name: "Not ticked" });
    await expect(first).not.toBeChecked();
    // The space bar, with the box focused, as for a button.
    await userEvent.tab();
    await expect(first).toHaveFocus();
    await userEvent.keyboard(" ");
    await expect(first).toBeChecked();
    await expect(first).toHaveAttribute("data-checked");
    await userEvent.keyboard(" ");
    await expect(first).not.toBeChecked();
    // A click on the label's words.
    await userEvent.click(canvas.getByText("Not ticked"));
    await expect(first).toBeChecked();
    await expect(canvas.getByRole("checkbox", { name: "Disabled" })).toBeDisabled();
  },
};

// The native `<dialog>` the hard paywall opens. The primitive owns no open
// state: the caller mounts it to open it and unmounts it on `onDismiss`.
function DialogExample() {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Open dialog</Button>
      {open && (
        <Dialog onDismiss={() => setOpen(false)}>
          <Card>
            <CardHeader>
              <CardTitle>
                <DialogTitle>Upgrade required</DialogTitle>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <DialogDescription>
                The native dialog element, in the top layer, with the card as its surface.
              </DialogDescription>
            </CardContent>
            <CardFooter className="justify-end">
              <Button size="sm" onClick={() => setOpen(false)}>
                Upgrade
              </Button>
            </CardFooter>
          </Card>
        </Dialog>
      )}
    </>
  );
}

export const Dialogs: Story = {
  name: "Dialog",
  render: () => <DialogExample />,
};

export const ProgressBars: Story = {
  name: "ProgressBar",
  render: () => (
    <div className="w-full max-w-md space-y-4">
      <div className="space-y-1">
        <p className="text-sm font-medium">Healthy (42%)</p>
        <ProgressBar value={4200} max={10000} />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium">Near limit (85%)</p>
        <ProgressBar value={8500} max={10000} />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium">Over limit (100%+)</p>
        <ProgressBar value={10000} max={10000} />
      </div>
    </div>
  ),
};
