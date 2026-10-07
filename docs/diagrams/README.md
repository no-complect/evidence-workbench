# Documentation diagrams

The main documentation embeds a rendered PNG so readers do not need Mermaid
support in their Markdown viewer. The SVG provides a scalable version; the
`.mmd` file is the editable Mermaid source.

- [Architecture image](./architecture.png)
- [Scalable architecture image](./architecture.svg)
- [Mermaid source](./architecture.mmd)

To regenerate the assets with Mermaid CLI installed:

```bash
mmdc -i docs/diagrams/architecture.mmd -o docs/diagrams/architecture.svg -c docs/diagrams/mermaid-config.json -b white -w 1600
mmdc -i docs/diagrams/architecture.mmd -o docs/diagrams/architecture.png -c docs/diagrams/mermaid-config.json -b white -w 1600 -s 2
```

Run those commands from the repository root. Diagram generation is optional
maintainer tooling; starting the application requires no Mermaid installation.
