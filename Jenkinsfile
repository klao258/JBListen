pipeline {
    agent any

    environment {
        NODE_ENV = 'production'
        PM2_HOME = "${env.WORKSPACE}/.pm2"
    }

    triggers {
        githubPush()
    }

    stages {
        stage('拉取代码') {
            steps {
                echo '📥 拉取 GitHub 最新代码...'
                checkout scm
            }
        }

        stage('检测 Telegram Session') {
            steps {
                echo '🔍 检查 Node 和 Python 会话是否存在'
                sh 'node check_env.js'
            }
        }

        stage('安装依赖') {
            steps {
                echo '📦 安装依赖...'
                sh 'npm run installAll'
            }
        }

        stage('启动服务') {
            steps {
                echo '🚀 启动服务中...'
                sh 'npm start'
            }
        }
    }

    post {
        success {
            echo '✅ 部署完成，访问地址：http://jblisten.sso66s.cc'
        }
        failure {
            echo '❌ 部署失败，请检查日志'
        }
    }
}