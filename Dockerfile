FROM python:3.11-slim

# 安装中文字体支持（解决批量上传PDF中文显示空白/黑框问题）
RUN apt-get update && apt-get install -y --no-install-recommends \
    fonts-noto-cjk \
    fonts-wqy-microhei \
    fontconfig \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* \
    && fc-cache -f -v

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
ENV TZ=Asia/Shanghai
ENV COS_SECRET_ID="AKIDM3ficMuJXbUAj9NODqJZ8Vr7B5pOmHgH"
ENV COS_SECRET_KEY="Z2d6QbdS7KNFuPl9PVTIxRjprjT2OYLx"
ENV COS_REGION="ap-shanghai"
ENV COS_BUCKET="pdf-template-1411244947"
ENV COS_PREFIX="pdf-templates/"
ENV MYSQL_HOST="sh-cynosdbmysql-grp-5awkhsnm.sql.tencentcdb.com"
ENV MYSQL_PORT="21797"
ENV MYSQL_DATABASE="pdf-generator-prod-8dk636da61e07"
ENV MYSQL_USER="admin"
ENV MYSQL_PASSWORD="Kx7#mPqR2@nL9vZw"
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
