# The web app built once and served by Vite's static preview server. Built by the root compose.yaml.
FROM node:22-slim
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10 --activate
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
# The API's address as the browser sees it, baked into the build.
ARG VITE_API_URL=http://localhost:8080
ENV VITE_API_URL=$VITE_API_URL
RUN pnpm build
EXPOSE 5173
CMD ["pnpm", "exec", "vite", "preview", "--host", "0.0.0.0", "--port", "5173", "--strictPort"]
