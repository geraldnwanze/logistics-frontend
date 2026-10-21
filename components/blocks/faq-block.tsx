import type { BlockProps } from "@/lib/cms/schemas";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Container, RichHtml, SectionHeading } from "./shared";

export function Faq({ props }: { props: BlockProps<"faq"> }) {
  return (
    <Container className="max-w-3xl py-16">
      <SectionHeading heading={props.heading} intro={props.intro} />
      <Accordion type="multiple">
        {props.items.map((item, index) => (
          <AccordionItem key={index} value={`item-${index}`}>
            <AccordionTrigger>{item.question}</AccordionTrigger>
            <AccordionContent>
              <RichHtml html={item.answer_html} />
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </Container>
  );
}
