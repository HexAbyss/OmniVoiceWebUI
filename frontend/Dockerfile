# =============================================================================
# OmniVoice — Frontend (Nginx serving static files + API proxy)
# Build context: ./frontend
# =============================================================================

FROM nginx:1.27-alpine

# Remove default Nginx config
RUN rm /etc/nginx/conf.d/default.conf

# Copy custom Nginx config
COPY nginx.conf /etc/nginx/conf.d/omnivoice.conf

# Copy static frontend assets
COPY index.html  /usr/share/nginx/html/index.html
COPY styles.css  /usr/share/nginx/html/styles.css
COPY app.js      /usr/share/nginx/html/app.js

EXPOSE 80

# Nginx runs in the foreground by default in the official image
CMD ["nginx", "-g", "daemon off;"]
