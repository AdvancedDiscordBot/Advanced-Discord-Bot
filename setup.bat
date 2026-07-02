@echo off
echo 🚀 ADB Bot Setup Script
echo =====================
echo.

echo 📦 Installing dependencies...
npm install

echo.
echo ✅ Dependencies installed successfully!
echo.

echo 📋 Setting up environment file...
if not exist .env (
    copy .env.example .env
    echo ✅ Created .env file from template
    echo ⚠️  Please edit .env file with your bot credentials before continuing
) else (
    echo ⚠️  .env file already exists
)

echo.
echo 🎯 Next steps:
echo 1. Edit .env file with your Discord bot token and client ID
echo 2. Run: node deploy-commands.js
echo 3. Run: npm start
echo.

echo 📚 For detailed setup instructions, check README.md
echo.

pause
