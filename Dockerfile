FROM node:20-slim

WORKDIR /app

COPY package.json package-lock.json* ./
COPY server/package.json server/package.json
COPY web/package.json web/package.json

RUN npm install

COPY . .
RUN npm run build

EXPOSE 4000
CMD ["npm", "start"]
