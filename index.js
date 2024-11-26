const express = require('express');
const phpUnserialize = require('php-serialize').unserialize;
const mysql = require('mysql2');

const app = express();
const port = 9527;

// 封装响应处理函数
function sendSuccessResponse(res, data, msg = true) {
    res.status(200).json({ code: 200, data, msg });
}

function sendErrorResponse(res, statusCode, errorMessage, data = null) {
    res.status(statusCode).json({ code: statusCode, data, msg: false });
}

// 创建数据库连接池
const pool = mysql.createPool({
  host: 'localhost',
  user: 'root',
  password: 'root',
  database: 'zhaosucai',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// 连接到数据库
pool.getConnection((err, connection) => {
  if (err) {
    console.error('连接数据库失败: ', err);
    return;
  }
  console.log('成功连接到数据库');
  connection.release();
});

app.get('/', (req, res) => {
    sendSuccessResponse(res, { msg: 'aaa' });
});

// 定义一个处理效验码查询的路由
app.get('/verify', (req, res) => {
    const md5 = req.query.md5;
    if (!md5) {
        return sendErrorResponse(res, 400, '无效的MD5参数');
    }

    // 从连接池中获取连接
    pool.getConnection((err, connection) => {
        if (err) {
            console.error('获取数据库连接失败: ', err);
            return sendErrorResponse(res, 500, '数据库连接错误');
        }

        // 使用 LIKE 查询来匹配包含 MD5 的记录
        const query = 'SELECT meta_value FROM tb_postmeta WHERE meta_value LIKE ?';
        connection.query(query, [`%${md5}%`], (err, results) => {
            // 释放连接
            connection.release();

            if (err) {
                console.error('数据库查询错误: ', err);
                return sendErrorResponse(res, 500, '数据库查询错误');
            }
            
            if (results.length === 0) {
                return sendErrorResponse(res, 404, '未找到相关数据', null);
            }

            try {
                const metaValue = results[0].meta_value;
                const parsedData = phpUnserialize(metaValue);
                sendSuccessResponse(res, parsedData);
            } catch (parseError) {
                console.error('解析错误: ', parseError);
                sendErrorResponse(res, 500, '解析数据错误');
            }
        });
    });
});

// 启动服务器
app.listen(port, () => {
    console.log(`服务器正在运行在 http://localhost:${port}`);
});