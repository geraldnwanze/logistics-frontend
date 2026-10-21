"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Menu, X } from "lucide-react";
import { useState } from "react";
import type { MenuItem } from "@/lib/cms/schemas";
import { CmsLink } from "./cms-link";

export function MobileNav({ items, label }: { items: MenuItem[]; label: string }) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger className="inline-flex size-11 items-center justify-center rounded-md hover:bg-foreground/5 md:hidden" aria-label="Open menu">
        <Menu aria-hidden className="size-6" />
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50" />
        <Dialog.Content className="fixed inset-y-0 right-0 z-50 w-[min(22rem,90vw)] overflow-y-auto bg-background p-6 shadow-xl focus:outline-none">
          <div className="mb-6 flex items-center justify-between">
            <Dialog.Title className="font-semibold">{label}</Dialog.Title>
            <Dialog.Close className="inline-flex size-11 items-center justify-center rounded-md hover:bg-foreground/5" aria-label="Close menu">
              <X aria-hidden className="size-6" />
            </Dialog.Close>
          </div>
          <Dialog.Description className="sr-only">Site navigation</Dialog.Description>
          <nav aria-label="Mobile">
            <ul className="space-y-1">
              {items.map((item) => (
                <li key={item.label}>
                  {item.href ? (
                    <CmsLink href={item.href} onClick={() => setOpen(false)} className="block rounded-md px-3 py-3 text-lg font-medium hover:bg-foreground/5">{item.label}</CmsLink>
                  ) : (
                    <p className="px-3 pt-4 text-sm font-semibold tracking-wide uppercase opacity-60">{item.label}</p>
                  )}
                  {item.children?.length ? (
                    <ul className="ml-3 border-l border-foreground/15 pl-2">
                      {item.children.map((child) => (
                        <li key={child.label}>
                          {child.href ? <CmsLink href={child.href} onClick={() => setOpen(false)} className="block rounded-md px-3 py-2.5 hover:bg-foreground/5">{child.label}</CmsLink> : null}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ul>
          </nav>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
