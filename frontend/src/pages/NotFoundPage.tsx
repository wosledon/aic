import { Box, Button, Typography } from '@mui/material';
import { useNavigate } from 'react-router-dom';

export function NotFoundPage() {
  const navigate = useNavigate();
  return (
    <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', p: 3 }}>
      <Box sx={{ textAlign: 'center' }}>
        <Typography variant="h1" sx={{ fontSize: '4rem', color: 'primary.main' }}>
          404
        </Typography>
        <Typography variant="h3" sx={{ mb: 1 }}>
          页面不存在
        </Typography>
        <Typography color="text.secondary" sx={{ mb: 3 }}>
          你访问的地址可能已被移动或删除。
        </Typography>
        <Button variant="contained" onClick={() => navigate('/')}>
          返回首页
        </Button>
      </Box>
    </Box>
  );
}